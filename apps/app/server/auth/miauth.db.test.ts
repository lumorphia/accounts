import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.ts";
import { loadEnv } from "../env.ts";

const databaseUrl = process.env.DATABASE_URL;
const origin = "https://accounts.lumorphia.test:3443";
const host = "127.0.0.1:3399";
const headers = { host: "accounts.lumorphia.test:3443", origin, "x-forwarded-proto": "https" };
const identity = {
  id: `test-${crypto.randomUUID()}`,
  username: "test_misskey",
  name: "Test Misskey",
};

function cookiesOf(res: { headers: Record<string, unknown> }): string {
  const raw = res.headers["set-cookie"];
  return (Array.isArray(raw) ? raw : raw ? [String(raw)] : [])
    .map((cookie) => String(cookie).split(";")[0])
    .join("; ");
}

function fakeMisskey(input: string | URL | Request): Promise<Response> {
  const url = new URL(
    typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
  );
  if (url.pathname === "/api/meta")
    return Promise.resolve(Response.json({ version: "2026.1", features: { miauth: true } }));
  if (/^\/api\/miauth\/[^/]+\/check$/.test(url.pathname))
    return Promise.resolve(Response.json({ ok: true, user: identity }));
  return Promise.resolve(new Response("not found", { status: 404 }));
}

describe.skipIf(!databaseUrl)("MiAuth", () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = await buildApp({
      env: loadEnv({
        NODE_ENV: "test",
        DATABASE_URL: databaseUrl,
        AUTH_SECRET: "test-secret-test-secret-test-secret-1234",
        AUTH_BASE_URL: origin,
        MIAUTH_DEV_HOSTS: host,
        LOG_LEVEL: "silent",
      }),
      miauthFetch: fakeMisskey as typeof fetch,
    });
    await app.ready();
  });
  afterAll(async () => {
    await app?.close();
  });

  async function start() {
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/miauth/start",
      headers,
      payload: { host },
    });
    expect(res.statusCode, res.body).toBe(200);
    return res;
  }
  async function login() {
    const res = await start();
    const session = new URL(res.json<{ url: string }>().url).pathname.split("/").pop()!;
    return app.inject({
      method: "GET",
      url: `/api/auth/miauth/callback?session=${session}`,
      headers: { ...headers, cookie: cookiesOf(res) },
    });
  }

  it("creates a pending user and reuses the same identity", async () => {
    const first = await login();
    expect(first.statusCode, first.body).toBe(302);
    const me = await app.inject({
      method: "GET",
      url: "/api/me",
      headers: { cookie: cookiesOf(first) },
    });
    expect(me.json().user).toMatchObject({ status: "pending", name: identity.name });
    const second = await login();
    const again = await app.inject({
      method: "GET",
      url: "/api/me",
      headers: { cookie: cookiesOf(second) },
    });
    expect(again.json().user.id).toBe(me.json().user.id);
  });

  it("rejects a callback without the matching session cookie", async () => {
    const res = await start();
    const session = new URL(res.json<{ url: string }>().url).pathname.split("/").pop()!;
    const callback = await app.inject({
      method: "GET",
      url: `/api/auth/miauth/callback?session=${session}`,
      headers,
    });
    expect(callback.statusCode).toBe(400);
  });

  it("rejects a private host outside the development allowlist", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/miauth/start",
      headers,
      payload: { host: "127.0.0.1" },
    });
    expect(res.statusCode).toBe(400);
  });
});
