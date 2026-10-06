import { describe, expect, it } from "vitest";
import { buildCspDirectives, serializeCsp } from "./csp.ts";

const base = { nonce: "n0nce", imageBaseUrl: "https://img.lumorphia.test", sentryDsn: null };

describe("buildCspDirectives", () => {
  it("allows scripts only from itself and the request nonce", () => {
    expect(buildCspDirectives(base)["script-src"]).toEqual(["'self'", "'nonce-n0nce'"]);
  });

  it("does not allow eval or WebAssembly", () => {
    const script = buildCspDirectives(base)["script-src"]!.join(" ");
    expect(script).not.toMatch(/unsafe-eval|wasm-unsafe-eval|unsafe-inline/);
  });

  it("allows icons from the image host and from https providers", () => {
    expect(buildCspDirectives(base)["img-src"]).toEqual([
      "'self'",
      "https://img.lumorphia.test",
      "data:",
      "https:",
    ]);
  });

  it("lets the browser send errors to the Sentry host", () => {
    const d = buildCspDirectives({ ...base, sentryDsn: "https://key@o1.ingest.sentry.io/2" });
    expect(d["connect-src"]).toEqual(["'self'", "https://o1.ingest.sentry.io"]);
  });

  it("adds the OAuth mock host to images only when given", () => {
    const d = buildCspDirectives({ ...base, oauthMockOrigin: "http://127.0.0.1:4010/x" });
    expect(d["img-src"]).toContain("http://127.0.0.1:4010");
  });

  it("forbids framing, plugins and foreign base URLs", () => {
    const d = buildCspDirectives(base);
    expect(d["frame-ancestors"]).toEqual(["'none'"]);
    expect(d["object-src"]).toEqual(["'none'"]);
    expect(d["base-uri"]).toEqual(["'self'"]);
  });

  it("ignores a relative image base URL", () => {
    expect(buildCspDirectives({ ...base, imageBaseUrl: "/img" })["img-src"]).toEqual([
      "'self'",
      "data:",
      "https:",
    ]);
  });
});

describe("serializeCsp", () => {
  it("joins the directives with semicolons", () => {
    expect(serializeCsp({ "default-src": ["'self'"], "img-src": ["'self'", "data:"] })).toBe(
      "default-src 'self'; img-src 'self' data:",
    );
  });
});
