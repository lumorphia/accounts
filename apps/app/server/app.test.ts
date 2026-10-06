import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "./app.ts";
import { loadEnv } from "./env.ts";

// DB を使わない振る舞い。DB につないだ死活確認は app.db.test.ts
let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp({
    env: loadEnv({ NODE_ENV: "test", DATABASE_URL: "postgres://unused/unused" }),
    skipDb: true,
  });
});

afterAll(async () => {
  await app.close();
});

describe("security headers", () => {
  it("forbids framing", async () => {
    const res = await app.inject({ method: "GET", url: "/api/health" });
    expect(res.headers["x-frame-options"]).toBe("DENY");
  });

  it("sends a CSP with a fresh nonce outside development", async () => {
    const a = await app.inject({ method: "GET", url: "/api/health" });
    const b = await app.inject({ method: "GET", url: "/api/health" });
    const nonce = (csp: unknown) => /'nonce-([^']+)'/.exec(String(csp))?.[1];
    expect(nonce(a.headers["content-security-policy"])).toBeTruthy();
    expect(nonce(a.headers["content-security-policy"])).not.toBe(
      nonce(b.headers["content-security-policy"]),
    );
  });

  it("turns off camera, microphone and geolocation", async () => {
    const res = await app.inject({ method: "GET", url: "/api/health" });
    expect(res.headers["permissions-policy"]).toBe("camera=(), microphone=(), geolocation=()");
  });
});

describe("CSRF", () => {
  it("lets OAuth protocol requests reach client authentication without an Origin", async () => {
    for (const path of ["token", "introspect", "revoke"]) {
      const res = await app.inject({ method: "POST", url: `/api/auth/oauth2/${path}` });
      expect(res.statusCode).toBe(404);
    }
  });

  it("still requires an Origin for paths adjacent to OAuth protocol endpoints", async () => {
    const res = await app.inject({ method: "POST", url: "/api/auth/oauth2/token/extra" });
    expect(res.statusCode).toBe(403);
  });
  it("rejects a mutating API request without an Origin header", async () => {
    const res = await app.inject({ method: "POST", url: "/api/anything" });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: { code: "forbidden", message: "missing origin" } });
  });

  it("rejects a mutating API request from another origin", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/anything",
      headers: { origin: "https://evil.example", host: "accounts.lumorphia.test" },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.message).toBe("origin mismatch");
  });

  it("lets a same-origin mutating request reach the route", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/anything",
      headers: { origin: "https://accounts.lumorphia.test", host: "accounts.lumorphia.test" },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe("API routing", () => {
  it("answers an unknown API path with a JSON 404", async () => {
    const res = await app.inject({ method: "GET", url: "/api/nope" });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({
      error: { code: "not_found", message: "route not found: GET /api/nope" },
    });
  });

  it("accepts a CSP violation report without an Origin header", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/csp-report",
      headers: { "content-type": "application/csp-report" },
      payload: JSON.stringify({ "csp-report": { "document-uri": "https://a/b" } }),
    });
    expect(res.statusCode).toBe(204);
  });
});

describe("health without a database", () => {
  it("reports the database as down with 503", async () => {
    const res = await app.inject({ method: "GET", url: "/api/health" });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ ok: false, db: "error" });
  });
});
