import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { HttpLodestoneSource } from "./http.ts";

const fixture = (name: string) =>
  readFileSync(new URL(`../fixtures/lodestone/${name}`, import.meta.url), "utf8");

function source(
  handler: (url: string, n: number, init?: RequestInit) => Response | Promise<Response>,
) {
  let n = 0;
  let clock = 0;
  const calls: string[] = [];
  const sleeps: number[] = [];
  const src = new HttpLodestoneSource({
    fetch: (async (input, init) => {
      const url = String(input);
      calls.push(url);
      return handler(url, n++, init);
    }) as typeof fetch,
    sleep: async (ms) => {
      sleeps.push(ms);
      clock += ms;
    },
    now: () => clock,
    userAgent: "lumorphia-accounts/test",
  });
  return { src, calls, sleeps };
}

describe("HttpLodestoneSource", () => {
  it("retries a failed response body read", async () => {
    const { src, calls } = source((_url, n) =>
      n === 0
        ? new Response(
            new ReadableStream({
              start(controller) {
                controller.error(new Error("test-body-failure"));
              },
            }),
          )
        : new Response(fixture("search-empty.html")),
    );
    await expect(src.searchCharacter("Test Character", "Tiamat")).resolves.toEqual([]);
    expect(calls).toHaveLength(2);
  });
  it("requests a Japanese character page with identification and a timeout", async () => {
    const { src, calls } = source((_url, _n, init) => {
      expect(new Headers(init?.headers).get("user-agent")).toBe("lumorphia-accounts/test");
      expect(new Headers(init?.headers).get("accept-language")).toBe("ja");
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      return new Response(fixture("character-15022394.html"));
    });
    expect(await src.fetchCharacter("15022394")).toMatchObject({ name: "Hal Myth" });
    expect(calls).toEqual(["https://jp.finalfantasyxiv.com/lodestone/character/15022394/"]);
  });
  it("encodes search parameters", async () => {
    const { src, calls } = source(() => new Response(fixture("search-empty.html")));
    await src.searchCharacter("Test & Character", "Tiamat");
    const url = new URL(calls[0]!);
    expect(url.searchParams.get("q")).toBe("Test & Character");
    expect(url.searchParams.get("worldname")).toBe("Tiamat");
  });
  it("keeps one second between character and search requests", async () => {
    const { src, sleeps } = source(
      (url) =>
        new Response(
          fixture(url.includes("15022394") ? "character-15022394.html" : "search-empty.html"),
        ),
    );
    await src.fetchCharacter("15022394");
    await src.searchCharacter("Test Character", "Tiamat");
    expect(sleeps).toEqual([1000]);
  });
  it("serializes concurrent requests", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { src, calls, sleeps } = source(async (_url, n) => {
      if (n === 0) await gate;
      return new Response(fixture("search-empty.html"));
    });
    const first = src.searchCharacter("Test First", "Tiamat");
    const second = src.searchCharacter("Test Second", "Tiamat");
    await Promise.resolve();
    await Promise.resolve();
    expect(calls).toHaveLength(1);
    release();
    await Promise.all([first, second]);
    expect(calls).toHaveLength(2);
    expect(sleeps).toEqual([1000]);
  });
  it("does not retry a missing page", async () => {
    const { src, calls } = source(() => new Response("", { status: 404 }));
    await expect(src.fetchCharacter("1")).rejects.toMatchObject({ code: "not_found" });
    expect(calls).toHaveLength(1);
  });
  it("honors Retry-After before reporting rate limiting", async () => {
    const { src, calls, sleeps } = source(
      () => new Response("", { status: 429, headers: { "retry-after": "2" } }),
    );
    await expect(src.fetchCharacter("1")).rejects.toMatchObject({ code: "rate_limited" });
    expect(calls).toHaveLength(3);
    expect(sleeps).toEqual([2000, 2000]);
  });
  it("recovers from a server error", async () => {
    const { src, calls } = source((_url, n) =>
      n === 0 ? new Response("", { status: 503 }) : new Response(fixture("search-empty.html")),
    );
    await expect(src.searchCharacter("Test Character", "Tiamat")).resolves.toEqual([]);
    expect(calls).toHaveLength(2);
  });
  it("reports a network failure after bounded retries", async () => {
    const { src, calls } = source(() => {
      throw new Error("test-network-failure");
    });
    await expect(src.fetchCharacter("1")).rejects.toMatchObject({ code: "unavailable" });
    expect(calls).toHaveLength(3);
  });
  it("does not retry other client errors", async () => {
    const { src, calls } = source(() => new Response("", { status: 403 }));
    await expect(src.fetchCharacter("1")).rejects.toMatchObject({ code: "unavailable" });
    expect(calls).toHaveLength(1);
  });
  it("continues the queue after a failed request", async () => {
    const { src } = source((_url, n) =>
      n === 0 ? new Response("", { status: 404 }) : new Response(fixture("search-empty.html")),
    );
    await expect(src.fetchCharacter("1")).rejects.toMatchObject({ code: "not_found" });
    await expect(src.searchCharacter("Test Character", "Tiamat")).resolves.toEqual([]);
  });
  it.each(["../admin", "0", "01", "1234567890123", "", "1?test=1"])(
    "does not request an invalid id %j",
    async (id) => {
      const { src, calls } = source(() => new Response(""));
      await expect(src.fetchCharacter(id)).rejects.toMatchObject({ code: "not_found" });
      expect(calls).toEqual([]);
    },
  );
});
