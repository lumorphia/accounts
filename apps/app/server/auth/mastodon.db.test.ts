import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { eq, schema } from "@lumorphia-accounts/db";
import { buildApp } from "../app.ts";
import { loadEnv } from "../env.ts";

const databaseUrl = process.env.DATABASE_URL;
const origin = "https://accounts.lumorphia.test:3443";
const host = "127.0.0.1:3402";
const headers = { host: "accounts.lumorphia.test:3443", origin, "x-forwarded-proto": "https" };
const identity = {
  id: `test-${crypto.randomUUID()}`,
  username: "test_mastodon",
  display_name: "Test Mastodon",
};
let registrations = 0;
let revocations = 0;

function cookiesOf(res: { headers: Record<string, unknown> }): string {
  const raw = res.headers["set-cookie"];
  return (Array.isArray(raw) ? raw : raw ? [String(raw)] : [])
    .map((cookie) => String(cookie).split(";")[0])
    .join("; ");
}

async function fakeMastodon(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  const url = new URL(
    typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
  );
  if (url.pathname === "/api/v1/apps") {
    registrations += 1;
    return Response.json({ client_id: "test-client", client_secret: "test-secret" });
  }
  if (url.pathname === "/oauth/token") return Response.json({ access_token: "test-token" });
  if (url.pathname === "/api/v1/accounts/verify_credentials") return Response.json(identity);
  if (url.pathname === "/oauth/revoke" && init?.method === "POST") {
    revocations += 1;
    return Response.json({});
  }
  return new Response("not found", { status: 404 });
}

describe.skipIf(!databaseUrl)("Mastodon", () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = await buildApp({
      env: loadEnv({
        NODE_ENV: "test",
        DATABASE_URL: databaseUrl,
        AUTH_SECRET: "test-secret-test-secret-test-secret-1234",
        AUTH_BASE_URL: origin,
        MASTODON_DEV_HOSTS: host,
        LOG_LEVEL: "silent",
      }),
      mastodonFetch: fakeMastodon as typeof fetch,
    });
    await app.ready();
  });
  afterAll(async () => {
    await app?.close();
  });

  async function start() {
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/mastodon/start",
      headers,
      payload: { host },
    });
    expect(res.statusCode, res.body).toBe(200);
    return res;
  }
  async function login() {
    const res = await start();
    const state = new URL(res.json<{ url: string }>().url).searchParams.get("state")!;
    return app.inject({
      method: "GET",
      url: `/api/auth/mastodon/callback?code=test-code&state=${state}`,
      headers: { ...headers, cookie: cookiesOf(res) },
    });
  }

  it("registers the instance once and reuses its client", async () => {
    expect((await login()).statusCode).toBe(302);
    expect((await login()).statusCode).toBe(302);
    expect(registrations).toBe(1);
    const client = await app.db.query.mastodonApps.findFirst({
      where: eq(schema.mastodonApps.host, host),
    });
    expect(client?.clientId).toBe("test-client");
  });

  it("creates a pending user without storing an access token", async () => {
    const res = await login();
    const me = await app.inject({
      method: "GET",
      url: "/api/me",
      headers: { cookie: cookiesOf(res) },
    });
    expect(me.json().user).toMatchObject({ status: "pending", name: identity.display_name });
    const account = await app.db.query.accounts.findFirst({
      where: eq(schema.accounts.accountId, `${host}:${identity.id}`),
    });
    expect(account?.accessToken).toBeNull();
    expect(revocations).toBeGreaterThan(0);
  });

  it("rejects a callback without the matching state cookie", async () => {
    const res = await start();
    const state = new URL(res.json<{ url: string }>().url).searchParams.get("state")!;
    const callback = await app.inject({
      method: "GET",
      url: `/api/auth/mastodon/callback?code=test-code&state=${state}`,
      headers,
    });
    expect(callback.statusCode).toBe(400);
  });
});
