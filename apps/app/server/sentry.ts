import * as Sentry from "@sentry/node";
import {
  sanitizeSentryBreadcrumb,
  sanitizeSentryErrorEvent,
  sanitizeSentrySpan,
  sanitizeSentryTransactionEvent,
} from "@lumorphia/ops/sentry";
import type { Breadcrumb, ErrorEvent, NodeOptions } from "@sentry/node";

type SentryConfig = {
  dsn: string;
  environment: string;
  release: string;
};

/** 例外とスタック以外の自動収集コンテキストを外部へ送らない。 */
function errorOnly(event: ErrorEvent): ErrorEvent {
  return sanitizeSentryErrorEvent(event as unknown as Record<string, unknown>, [
    "runtime",
    "method",
    "route",
    "requestId",
  ]) as unknown as ErrorEvent;
}

export function createServerSentryOptions(config: SentryConfig): NodeOptions {
  return {
    dsn: config.dsn,
    enabled: config.dsn.length > 0,
    environment: config.environment,
    release: config.release,
    initialScope: { tags: { runtime: "server" } },
    sendDefaultPii: false,
    tracesSampleRate: 0.1,
    enableLogs: false,
    maxBreadcrumbs: 20,
    includeLocalVariables: false,
    beforeBreadcrumb: (breadcrumb) => sanitizeSentryBreadcrumb(breadcrumb) as Breadcrumb | null,
    beforeSendSpan: (span) => sanitizeSentrySpan(span) as unknown as typeof span,
    beforeSendTransaction: (event) =>
      sanitizeSentryTransactionEvent(event as unknown as Record<string, unknown>, [
        "runtime",
      ]) as unknown as typeof event,
    beforeSend: errorOnly,
  };
}

const dsn = process.env.SENTRY_DSN?.trim() ?? "";
if (dsn) {
  Sentry.init(
    createServerSentryOptions({
      dsn,
      environment: process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV ?? "development",
      release: process.env.APP_VERSION ?? "dev",
    }),
  );
}

export type ErrorContext = Record<string, string> & { runtime: "server" | "worker" };
export type CaptureException = (error: unknown, context: ErrorContext) => void;

export const captureServerException: CaptureException = (error, context) => {
  if (!dsn) return;
  Sentry.withScope((scope) => {
    scope.setTags(context);
    Sentry.captureException(error);
  });
};
