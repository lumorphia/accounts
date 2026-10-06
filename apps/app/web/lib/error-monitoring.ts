import type { Breadcrumb, BrowserOptions, ErrorEvent } from "@sentry/react";
import {
  sanitizeSentryBreadcrumb,
  sanitizeSentryErrorEvent,
  sanitizeSentrySpan,
  sanitizeSentryTransactionEvent,
} from "@lumorphia/ops/sentry";
import { isRouteErrorResponse } from "react-router";
import { isStaleChunkError } from "./stale-chunk.ts";

type BrowserMonitoringConfig = { dsn: string; environment: string; release: string };
type ReplayPrivacyOptions = {
  maskAllText: boolean;
  maskAllInputs: boolean;
  blockAllMedia: boolean;
  networkDetailAllowUrls: (string | RegExp)[];
  networkRequestHeaders: string[];
  networkResponseHeaders: string[];
  networkCaptureBodies: boolean;
  beforeAddRecordingEvent(event: object): object | null;
};
type BrowserSentry = {
  init(options: BrowserOptions): void;
  captureException(error: unknown): unknown;
  browserTracingIntegration(): unknown;
  replayIntegration(options: ReplayPrivacyOptions): unknown;
};
type BrowserSentryLoader = () => Promise<BrowserSentry>;
type BrowserIntegrationArray = Extract<
  NonNullable<BrowserOptions["integrations"]>,
  readonly unknown[]
>;

type ReplayRecordingEvent = {
  data?: { tag?: string; payload?: unknown };
};

/** 裏の先読みで前の版のファイルが取れなかったもの。リリースのたびに起き、移るときは React Router が読み直すので送らない (stale-chunk.ts) */
function isStaleChunkPrefetchEvent(event: ErrorEvent): boolean {
  return (event.exception?.values ?? []).some(
    (value) =>
      value.mechanism?.type === "auto.browser.global_handlers.onunhandledrejection" &&
      isStaleChunkError(value.value ?? ""),
  );
}

function errorOnly(event: ErrorEvent): ErrorEvent | null {
  if (isStaleChunkPrefetchEvent(event)) return null;
  return sanitizeSentryErrorEvent(event as unknown as Record<string, unknown>, [
    "runtime",
  ]) as unknown as ErrorEvent;
}

export function sanitizeReplayRecordingEvent(
  event: ReplayRecordingEvent,
): ReplayRecordingEvent | null {
  const tag = event.data?.tag;
  if (tag === "breadcrumb") {
    const payload = event.data?.payload;
    if (!payload || typeof payload !== "object") return null;
    const breadcrumb = sanitizeSentryBreadcrumb(payload);
    return breadcrumb ? { ...event, data: { ...event.data, payload: breadcrumb } } : null;
  }
  if (tag === "performanceSpan") {
    const payload = event.data?.payload;
    if (!payload || typeof payload !== "object") return null;
    const input = payload as Record<string, unknown>;
    const span = sanitizeSentrySpan({
      trace_id: "replay",
      span_id: "replay",
      start_timestamp: input.startTimestamp,
      timestamp: input.endTimestamp,
      op: input.op,
      description: input.description,
      data:
        input.data && typeof input.data === "object" ? (input.data as Record<string, unknown>) : {},
    });
    return {
      ...event,
      data: {
        ...event.data,
        payload: {
          ...(span.op ? { op: span.op } : {}),
          ...(span.description ? { description: span.description } : {}),
          ...(input.startTimestamp !== undefined ? { startTimestamp: input.startTimestamp } : {}),
          ...(input.endTimestamp !== undefined ? { endTimestamp: input.endTimestamp } : {}),
          data: span.data,
        },
      },
    };
  }
  return tag === "options" ? event : null;
}

function optionsFor(
  config: BrowserMonitoringConfig,
  integrations?: Pick<BrowserSentry, "browserTracingIntegration" | "replayIntegration">,
): BrowserOptions {
  return {
    dsn: config.dsn.trim(),
    environment: config.environment,
    release: config.release,
    initialScope: { tags: { runtime: "browser" } },
    sendDefaultPii: false,
    tracesSampleRate: 0.05,
    tracePropagationTargets: [/^\/api\//],
    enableLogs: false,
    maxBreadcrumbs: 20,
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 1,
    ...(integrations
      ? {
          integrations: [
            integrations.browserTracingIntegration(),
            integrations.replayIntegration({
              maskAllText: true,
              maskAllInputs: true,
              blockAllMedia: true,
              networkDetailAllowUrls: [],
              networkRequestHeaders: [],
              networkResponseHeaders: [],
              networkCaptureBodies: false,
              beforeAddRecordingEvent: sanitizeReplayRecordingEvent,
            }),
          ] as BrowserIntegrationArray,
        }
      : {}),
    beforeBreadcrumb: (breadcrumb) => sanitizeSentryBreadcrumb(breadcrumb) as Breadcrumb | null,
    beforeSendSpan: (span) => sanitizeSentrySpan(span) as unknown as typeof span,
    beforeSendTransaction: (event) =>
      sanitizeSentryTransactionEvent(event as unknown as Record<string, unknown>, [
        "runtime",
      ]) as unknown as typeof event,
    beforeSend: errorOnly,
  };
}

async function loadBrowserSentry(): Promise<BrowserSentry> {
  const { browserTracingIntegration, captureException, init, replayIntegration } =
    await import("@sentry/react");
  return {
    browserTracingIntegration: () => browserTracingIntegration(),
    captureException,
    init,
    replayIntegration: (options) =>
      replayIntegration(options as Parameters<typeof replayIntegration>[0]),
  };
}

export function createBrowserErrorMonitoring(loadSdk: BrowserSentryLoader) {
  let sdk: BrowserSentry | undefined;
  let loading: Promise<BrowserSentry> | undefined;

  return {
    initialize(config: BrowserMonitoringConfig): boolean {
      if (!config.dsn.trim()) return false;
      loading ??= loadSdk();
      void loading
        .then((loaded) => {
          sdk = loaded;
          loaded.init(optionsFor(config, loaded));
        })
        .catch(() => undefined);
      return true;
    },
    capture(error: unknown): void {
      if (sdk) {
        sdk.captureException(error);
        return;
      }
      if (loading) {
        void loading.then((loaded) => loaded.captureException(error)).catch(() => undefined);
      }
    },
  };
}

const browserErrorMonitoring = createBrowserErrorMonitoring(loadBrowserSentry);

export function initializeBrowserErrorMonitoring(
  config: BrowserMonitoringConfig,
  sdk?: Pick<BrowserSentry, "init"> &
    Partial<Pick<BrowserSentry, "browserTracingIntegration" | "replayIntegration">>,
): boolean {
  const dsn = config.dsn.trim();
  if (!dsn) return false;
  if (!sdk) return browserErrorMonitoring.initialize(config);
  const integrations =
    sdk.browserTracingIntegration && sdk.replayIntegration
      ? {
          browserTracingIntegration: sdk.browserTracingIntegration,
          replayIntegration: sdk.replayIntegration,
        }
      : undefined;
  sdk.init(optionsFor({ ...config, dsn }, integrations));
  return true;
}

export function captureBrowserException(error: unknown): void {
  browserErrorMonitoring.capture(error);
}

export function shouldCaptureBrowserError(error: unknown): boolean {
  return !isRouteErrorResponse(error) || error.status >= 500;
}
