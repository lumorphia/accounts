import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.ts";
import { loadEnv } from "../env.ts";

const origin = "https://accounts.lumorphia.test:3443";
const website = "https://lumorphia.test:3444";

describe.skipIf(!process.env.DATABASE_URL)("website session", () => {
  let app: FastifyInstance;
  let cookie: string;
  beforeAll(async () => {
    app = await buildApp({
      env: loadEnv({
        NODE_ENV: "test",
        DATABASE_URL: process.env.DATABASE_URL,
        AUTH_BASE_URL: origin,
        WEBSITE_ORIGIN: website,
        LOG_LEVEL: "silent",
      }),
    });
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/dev/login",
      headers: { host: new URL(origin).host, origin, "x-forwarded-proto": "https" },
      payload: { handle: "test_website", name: "Website User" },
    });
    const cookies = res.headers["set-cookie"];
    cookie = (Array.isArray(cookies) ? cookies : [String(cookies)])
      .map((value) => value.split(";")[0])
      .join("; ");
  });
  afterAll(async () => {
    await app?.close();
  });
  it("returns only header profile fields to the configured website", async () => {
    const res = await app.inject({
      url: "/api/website/session",
      headers: { origin: website, cookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      user: { name: "Website User", handle: "test_website", image: null },
    });
    expect(res.headers["access-control-allow-origin"]).toBe(website);
    expect(res.headers["access-control-allow-credentials"]).toBe("true");
    expect(res.headers["cache-control"]).toBe("private, no-store");
  });
  it("does not expose a session to an untrusted origin", async () => {
    const res = await app.inject({
      url: "/api/website/session",
      headers: { origin: "https://evil.example", cookie },
    });
    expect(res.statusCode).toBe(403);
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });
  it("returns a guest without a session", async () => {
    const res = await app.inject({ url: "/api/website/session", headers: { origin: website } });
    expect(res.json()).toEqual({ user: null });
  });
  it("keeps account mutations closed to the website origin", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: "/api/me/profile",
      headers: {
        origin: website,
        host: new URL(origin).host,
        cookie,
      },
      payload: { name: "Changed" },
    });
    expect(res.statusCode).toBe(403);
  });
  it("rejects logout navigation from an untrusted site", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/logout",
      headers: { origin: "https://evil.example", cookie },
    });
    expect(res.statusCode).toBe(403);
  });
  it("ends the session and returns to the configured website after logout", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/logout",
      headers: { origin: website, cookie },
    });
    expect(res.statusCode).toBe(303);
    expect(res.headers.location).toBe(`${website}/`);
    expect(
      (
        await app.inject({ url: "/api/website/session", headers: { origin: website, cookie } })
      ).json().user,
    ).toBeNull();
  });
});
