import { afterEach, describe, expect, it, vi } from "vitest";
import fastify from "fastify";
import { createShutdown } from "./graceful-shutdown.ts";

const silentLog = { info: () => {}, warn: () => {}, error: () => {} };

describe("createShutdown", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("closes the app and exits with 0 on the first signal", async () => {
    const close = vi.fn(async () => {});
    const exit = vi.fn();
    const shutdown = createShutdown({ close, log: silentLog }, { timeoutMs: 1000, exit });

    await shutdown("SIGTERM");

    expect(close).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(0);
  });

  it("exits with 1 when closing fails", async () => {
    const exit = vi.fn();
    const shutdown = createShutdown(
      { close: async () => Promise.reject(new Error("boom")), log: silentLog },
      { timeoutMs: 1000, exit },
    );

    await shutdown("SIGTERM");

    expect(exit).toHaveBeenCalledWith(1);
  });

  it("exits with 1 when in-flight requests outlast the timeout", async () => {
    vi.useFakeTimers();
    const exit = vi.fn();
    const shutdown = createShutdown(
      { close: () => new Promise(() => {}), log: silentLog },
      { timeoutMs: 1000, exit },
    );

    void shutdown("SIGTERM");
    await vi.advanceTimersByTimeAsync(1000);

    expect(exit).toHaveBeenCalledWith(1);
  });

  it("exits at once on a second signal while closing", async () => {
    const exit = vi.fn();
    const close = vi.fn(() => new Promise<void>(() => {}));
    const shutdown = createShutdown({ close, log: silentLog }, { timeoutMs: 60_000, exit });

    void shutdown("SIGTERM");
    await shutdown("SIGINT");

    expect(close).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(1);
  });
});

describe("graceful shutdown of a listening server", () => {
  it("lets an in-flight request finish, then stops accepting connections", async () => {
    const app = fastify();
    let release!: () => void;
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    let started!: () => void;
    const requestStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    app.get("/slow", async () => {
      started();
      await released;
      return { ok: true };
    });
    const address = await app.listen({ port: 0, host: "127.0.0.1" });
    const exit = vi.fn();
    const shutdown = createShutdown(app, { timeoutMs: 5000, exit });

    const inFlight = fetch(`${address}/slow`);
    await requestStarted;
    const closing = shutdown("SIGTERM");
    release();
    const res = await inFlight;
    await closing;

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(exit).toHaveBeenCalledWith(0);
    await expect(fetch(`${address}/slow`)).rejects.toThrow();
  });
});
