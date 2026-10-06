import { afterEach, describe, expect, it, vi } from "vitest";
import { captureServerException, createServerSentryOptions } from "./sentry.ts";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.doUnmock("@sentry/node");
});

describe("createServerSentryOptions", () => {
  const config = {
    dsn: "https://public@example.ingest.sentry.io/1",
    environment: "production",
    release: "1.2.3+abcdef0",
  };

  it("enables low-rate tracing and removes request data", () => {
    const options = createServerSentryOptions(config);
    const event = options.beforeSend!(
      {
        type: undefined,
        exception: { values: [{ value: "boom" }] },
        user: { id: "user-1", email: "secret@example.com", ip_address: "192.0.2.1" },
        request: { url: "https://accounts.example/private?token=secret", cookies: { sid: "x" } },
        breadcrumbs: [
          {
            type: "http",
            category: "fetch",
            data: { method: "GET", status_code: 503, url: "/api/posts/private-id?token=x" },
          },
        ],
        contexts: {
          trace: { trace_id: "trace-1", span_id: "span-1", data: { token: "secret" } },
        },
        extra: { payload: "private" },
        transaction: "/settings",
      },
      {},
    );

    expect(options).toMatchObject({
      sendDefaultPii: false,
      tracesSampleRate: 0.1,
      enableLogs: false,
      maxBreadcrumbs: 20,
      initialScope: { tags: { runtime: "server" } },
      environment: "production",
      release: "1.2.3+abcdef0",
    });
    expect(event).toEqual({
      type: undefined,
      exception: { values: [{ value: "boom" }] },
      breadcrumbs: [
        {
          type: "http",
          category: "fetch",
          data: { method: "GET", status_code: 503, route: "/api/posts" },
        },
      ],
      contexts: { trace: { trace_id: "trace-1", span_id: "span-1" } },
    });
  });

  it("送信前にbreadcrumbを共通ルールで丸める", () => {
    const options = createServerSentryOptions(config);

    expect(
      options.beforeBreadcrumb!(
        {
          category: "navigation",
          data: { to: "/posts/private?token=secret" },
        },
        {},
      ),
    ).toEqual({ category: "navigation", data: { to: "/posts" } });
  });

  it("送信前にspanからSQLを除く", () => {
    const options = createServerSentryOptions(config);

    expect(
      options.beforeSendSpan!({
        trace_id: "trace-1",
        span_id: "span-1",
        start_timestamp: 1,
        op: "db.query",
        description: "select secret from users",
        data: { "db.system": "postgresql", "db.statement": "private" },
      }),
    ).toEqual({
      trace_id: "trace-1",
      span_id: "span-1",
      start_timestamp: 1,
      op: "db.query",
      description: "database",
      data: { "db.system": "postgresql" },
    });
  });

  it("送信前にtransactionのURLをルート群へ丸める", () => {
    const options = createServerSentryOptions(config);

    expect(
      options.beforeSendTransaction!(
        { type: "transaction", transaction: "/posts/private?token=secret" },
        {},
      ),
    ).toEqual({ type: "transaction", transaction: "/posts" });
  });

  it("does not capture when the DSN is missing", () => {
    expect(() =>
      captureServerException(new Error("boom"), { runtime: "server", route: "/test" }),
    ).not.toThrow();
  });

  it("initializes from the process environment and captures with safe tags", async () => {
    vi.resetModules();
    vi.stubEnv("SENTRY_DSN", "https://public@example.ingest.sentry.io/1");
    vi.stubEnv("SENTRY_ENVIRONMENT", "production");
    vi.stubEnv("APP_VERSION", "1.2.3+abcdef0");
    const init = vi.fn();
    const setTags = vi.fn();
    const captureException = vi.fn();
    const withScope = vi.fn((callback: (scope: { setTags: typeof setTags }) => void) =>
      callback({ setTags }),
    );
    vi.doMock("@sentry/node", () => ({ init, withScope, captureException }));

    const configured = await import("./sentry.ts");
    const error = new Error("boom");
    const context = { runtime: "server" as const, route: "/test", requestId: "req-1" };
    configured.captureServerException(error, context);

    expect(init).toHaveBeenCalledWith(
      expect.objectContaining({
        dsn: "https://public@example.ingest.sentry.io/1",
        environment: "production",
        release: "1.2.3+abcdef0",
      }),
    );
    expect(setTags).toHaveBeenCalledWith(context);
    expect(captureException).toHaveBeenCalledWith(error);
  });
});
