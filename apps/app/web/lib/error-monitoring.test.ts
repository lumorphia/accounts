import { describe, expect, it, vi } from "vitest";
import {
  createBrowserErrorMonitoring,
  initializeBrowserErrorMonitoring,
  sanitizeReplayRecordingEvent,
  shouldCaptureBrowserError,
} from "./error-monitoring.ts";

describe("createBrowserErrorMonitoring", () => {
  it("loads the SDK in the background and reports errors queued during loading", async () => {
    const init = vi.fn();
    const captureException = vi.fn();
    const browserTracingIntegration = vi.fn(() => ({ name: "BrowserTracing" }));
    const replayIntegration = vi.fn(() => ({ name: "Replay" }));
    const loadSdk = vi.fn(async () => ({
      init,
      captureException,
      browserTracingIntegration,
      replayIntegration,
    }));
    const monitoring = createBrowserErrorMonitoring(loadSdk);
    const error = new Error("hydration failed");

    expect(
      monitoring.initialize({
        dsn: "https://public@example.ingest.sentry.io/1",
        environment: "production",
        release: "1.2.3+abcdef0",
      }),
    ).toBe(true);
    monitoring.capture(error);

    await vi.waitFor(() => expect(captureException).toHaveBeenCalledWith(error));
    expect(loadSdk).toHaveBeenCalledOnce();
    expect(init).toHaveBeenCalledOnce();
  });
});

describe("initializeBrowserErrorMonitoring", () => {
  it("does nothing when the public DSN is not configured", () => {
    const init = vi.fn();

    expect(
      initializeBrowserErrorMonitoring(
        { dsn: "", environment: "development", release: "dev" },
        { init },
      ),
    ).toBe(false);
    expect(init).not.toHaveBeenCalled();
  });

  it("initializes error-only monitoring without PII context", () => {
    const init = vi.fn();
    const browserTracing = { name: "BrowserTracing" };
    const browserTracingIntegration = vi.fn(() => browserTracing);
    const replay = { name: "Replay" };
    const replayIntegration = vi.fn(() => replay);

    expect(
      initializeBrowserErrorMonitoring(
        {
          dsn: "https://public@example.ingest.sentry.io/1",
          environment: "production",
          release: "1.2.3+abcdef0",
        },
        { init, browserTracingIntegration, replayIntegration },
      ),
    ).toBe(true);
    const options = init.mock.calls[0]![0];
    const event = options.beforeSend(
      {
        type: undefined,
        message: "boom",
        user: { id: "user-1" },
        request: { url: "https://prismtone.example/settings?secret=x" },
        breadcrumbs: [
          {
            category: "navigation",
            data: { from: "/settings?secret=x", to: "/posts/private-id?draft=1" },
          },
          { category: "ui.click", message: "clicked private button" },
        ],
        contexts: {
          trace: { trace_id: "trace-1", span_id: "span-1", data: { token: "private" } },
          replay: { replay_id: "replay-1", secret: "private" },
          response: { body: "private" },
        },
        debug_meta: { images: [{ type: "sourcemap", debug_id: "debug-1" }] },
        extra: { payload: "private" },
        transaction: "/settings",
      },
      {},
    );
    expect(options).toMatchObject({
      sendDefaultPii: false,
      tracesSampleRate: 0.05,
      enableLogs: false,
      maxBreadcrumbs: 20,
      replaysSessionSampleRate: 0,
      replaysOnErrorSampleRate: 1,
      environment: "production",
      release: "1.2.3+abcdef0",
      initialScope: { tags: { runtime: "browser" } },
    });
    expect(options.tracePropagationTargets[0]).toEqual(/^\/api\//);
    expect(replayIntegration).toHaveBeenCalledWith({
      maskAllText: true,
      maskAllInputs: true,
      blockAllMedia: true,
      networkDetailAllowUrls: [],
      networkRequestHeaders: [],
      networkResponseHeaders: [],
      networkCaptureBodies: false,
      beforeAddRecordingEvent: expect.any(Function),
    });
    expect(options.integrations).toContain(replay);
    expect(options.integrations).toContain(browserTracing);
    expect(event).toEqual({
      type: undefined,
      message: "boom",
      breadcrumbs: [{ category: "navigation", data: { from: "/settings", to: "/posts" } }],
      contexts: {
        trace: { trace_id: "trace-1", span_id: "span-1" },
        replay: { replay_id: "replay-1" },
      },
      debug_meta: { images: [{ type: "sourcemap", debug_id: "debug-1" }] },
    });
  });
});

describe("sanitizeReplayRecordingEvent", () => {
  it("consoleとDOM操作をReplayから除外する", () => {
    expect(
      sanitizeReplayRecordingEvent({
        data: { tag: "breadcrumb", payload: { category: "console", message: "secret" } },
      }),
    ).toBeNull();
    expect(
      sanitizeReplayRecordingEvent({
        data: { tag: "breadcrumb", payload: { category: "ui.click", message: "private" } },
      }),
    ).toBeNull();
  });

  it("ReplayのHTTP spanからURLと本文を除去する", () => {
    expect(
      sanitizeReplayRecordingEvent({
        data: {
          tag: "performanceSpan",
          payload: {
            op: "resource.fetch",
            description: "https://prismtone.example/api/posts/private-id?token=x",
            startTimestamp: 1,
            endTimestamp: 2,
            data: {
              method: "POST",
              status_code: 500,
              url: "https://prismtone.example/api/posts/private-id?token=x",
              request_body: "private",
            },
          },
        },
      }),
    ).toEqual({
      data: {
        tag: "performanceSpan",
        payload: {
          op: "resource.fetch",
          description: "/api/posts",
          startTimestamp: 1,
          endTimestamp: 2,
          data: { route: "/api/posts" },
        },
      },
    });
  });
});

describe("shouldCaptureBrowserError", () => {
  it("does not report expected 4xx route responses", () => {
    expect(
      shouldCaptureBrowserError({
        status: 404,
        statusText: "Not Found",
        internal: false,
        data: null,
      }),
    ).toBe(false);
  });

  it("reports 5xx route responses and unexpected errors", () => {
    expect(
      shouldCaptureBrowserError({
        status: 503,
        statusText: "Unavailable",
        internal: false,
        data: null,
      }),
    ).toBe(true);
    expect(shouldCaptureBrowserError(new Error("boom"))).toBe(true);
  });
});

describe("古いファイルのエラー (リリース後に開いたままのタブ)", () => {
  const staleEvent = (mechanism: string) => ({
    exception: {
      values: [
        {
          type: "TypeError",
          value: "Failed to fetch dynamically imported module: https://x.test/assets/a-1.js",
          mechanism: { type: mechanism, handled: false },
        },
      ],
    },
  });

  function beforeSendOf() {
    const init = vi.fn();
    initializeBrowserErrorMonitoring(
      { dsn: "https://public@example.ingest.sentry.io/1", environment: "production", release: "1" },
      { init },
    );
    return init.mock.calls[0]![0].beforeSend as (event: unknown) => unknown;
  }

  it("裏の先読み (unhandledrejection) で起きたものは送らない", () => {
    expect(
      beforeSendOf()(staleEvent("auto.browser.global_handlers.onunhandledrejection")),
    ).toBeNull();
  });

  it("ページを移るときなど、ほかの経路で起きたものは送る (本当に壊れているのを見逃さない)", () => {
    expect(beforeSendOf()(staleEvent("generic"))).not.toBeNull();
  });
});
