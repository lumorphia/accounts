import { describe, expect, it } from "vitest";
import { rewriteOAuthUrl } from "./oauth-mock-fetch.ts";

const base = "http://127.0.0.1:3401";

describe("rewriteOAuthUrl", () => {
  it.each([
    ["https://discord.com/api/oauth2/token", `${base}/discord/api/oauth2/token`],
    ["https://discord.com/api/users/@me", `${base}/discord/api/users/@me`],
    ["https://oauth2.googleapis.com/token", `${base}/google/token`],
    ["https://api.x.com/2/oauth2/token", `${base}/x/2/oauth2/token`],
    [
      "https://api.x.com/2/users/me?user.fields=profile_image_url",
      `${base}/x/2/users/me?user.fields=profile_image_url`,
    ],
  ])("sends %s to the mock", (input, expected) => {
    expect(rewriteOAuthUrl(input, base)).toBe(expected);
  });

  it("leaves every other host alone", () => {
    expect(rewriteOAuthUrl("https://v2.xivapi.com/api/asset", base)).toBeNull();
    expect(rewriteOAuthUrl("http://127.0.0.1:3300/api/me", base)).toBeNull();
  });
});

describe("installOAuthMockFetch", () => {
  it("sends provider requests to the mock and everything else to the real fetch, keeping method and headers", async () => {
    const seen: { url: string; method: string; auth: string | null }[] = [];
    const original = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = new Request(input, init);
      seen.push({ url: req.url, method: req.method, auth: req.headers.get("authorization") });
      return new Response("ok");
    }) as typeof fetch;
    try {
      const { installOAuthMockFetch } = await import("./oauth-mock-fetch.ts");
      installOAuthMockFetch(base);
      await fetch("https://discord.com/api/users/@me", { headers: { authorization: "Bearer t" } });
      await fetch(new URL("https://api.x.com/2/oauth2/token"), { method: "POST" });
      await fetch(new Request("https://oauth2.googleapis.com/token", { method: "POST" }));
      await fetch("https://v2.xivapi.com/api/asset");
      expect(seen).toEqual([
        { url: `${base}/discord/api/users/@me`, method: "GET", auth: "Bearer t" },
        { url: `${base}/x/2/oauth2/token`, method: "POST", auth: null },
        { url: `${base}/google/token`, method: "POST", auth: null },
        { url: "https://v2.xivapi.com/api/asset", method: "GET", auth: null },
      ]);
      // 二重に包まない
      const once = globalThis.fetch;
      installOAuthMockFetch(base);
      expect(globalThis.fetch).toBe(once);
    } finally {
      globalThis.fetch = original;
    }
  });
});
