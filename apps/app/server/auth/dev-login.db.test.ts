import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.ts";
import { loadEnv } from "../env.ts";

const url = process.env.DATABASE_URL;
const host = "accounts.lumorphia.test:3443";
const headers = { origin: `https://${host}`, host, "x-forwarded-proto": "https" };
const handle = `dev_${Math.random().toString(36).slice(2, 10)}`;

function cookiesOf(res: { headers: Record<string, unknown> }): string {
  const raw = res.headers["set-cookie"];
  return (Array.isArray(raw) ? raw : raw ? [String(raw)] : [])
    .map((cookie) => String(cookie).split(";")[0])
    .join("; ");
}

describe.skipIf(!url)("development login", () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  beforeAll(async () => {
    app = await buildApp({
      env: loadEnv({
        NODE_ENV: "test",
        DATABASE_URL: url,
        AUTH_SECRET: "test-secret-test-secret-test-secret-1234",
        AUTH_BASE_URL: `https://${host}`,
        LOG_LEVEL: "silent",
      }),
    });
    await app.ready();
  });
  afterAll(async () => {
    await app?.close();
  });

  it("returns an anonymous user before login", async () => {
    const res = await app.inject({ method: "GET", url: "/api/me" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ user: null });
  });

  it("creates a session and reuses the same user", async () => {
    const first = await app.inject({
      method: "POST",
      url: "/api/auth/dev/login",
      headers,
      payload: { handle },
    });
    expect(first.statusCode, first.body).toBe(200);
    const me = await app.inject({
      method: "GET",
      url: "/api/me",
      headers: { cookie: cookiesOf(first) },
    });
    expect(me.json().user).toMatchObject({ handle, status: "active", role: "user" });
    const second = await app.inject({
      method: "POST",
      url: "/api/auth/dev/login",
      headers,
      payload: { handle },
    });
    const again = await app.inject({
      method: "GET",
      url: "/api/me",
      headers: { cookie: cookiesOf(second) },
    });
    expect(again.json().user.id).toBe(me.json().user.id);
  });
});
