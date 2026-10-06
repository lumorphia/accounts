import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { eq, schema } from "@lumorphia-accounts/db";
import { buildApp } from "../app.ts";
import { loadEnv } from "../env.ts";

const databaseUrl = process.env.DATABASE_URL;
const origin = "https://accounts.lumorphia.test:3443";
const headers = { host: "accounts.lumorphia.test:3443", origin, "x-forwarded-proto": "https" };
const stamp = crypto.randomUUID().slice(0, 8);
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

function cookiesOf(res: { headers: Record<string, unknown> }): string {
  const raw = res.headers["set-cookie"];
  return (Array.isArray(raw) ? raw : raw ? [String(raw)] : [])
    .map((cookie) => String(cookie).split(";")[0])
    .join("; ");
}

describe.skipIf(!databaseUrl)("me routes (PostgreSQL)", () => {
  let app: FastifyInstance;
  let activeCookie: string;
  let pendingCookie: string;
  let userId: string;
  const handle = `me_${stamp}`;

  beforeAll(async () => {
    app = await buildApp({
      env: loadEnv({
        NODE_ENV: "test",
        DATABASE_URL: databaseUrl,
        AUTH_SECRET: "test-secret-test-secret-test-secret-1234",
        AUTH_BASE_URL: origin,
        LOG_LEVEL: "silent",
      }),
    });
    await app.ready();
    const active = await app.inject({
      method: "POST",
      url: "/api/auth/dev/login",
      headers,
      payload: { handle },
    });
    activeCookie = cookiesOf(active);
    const me = await app.inject({
      method: "GET",
      url: "/api/me",
      headers: { cookie: activeCookie },
    });
    userId = me.json().user.id;
    const pending = await app.inject({
      method: "POST",
      url: "/api/auth/dev/login",
      headers,
      payload: { handle: `pending_${stamp}`, onboarded: false },
    });
    pendingCookie = cookiesOf(pending);
  });
  afterAll(async () => {
    await app?.close();
  });

  it("returns a nullable user and requires a session for account details", async () => {
    expect((await app.inject({ method: "GET", url: "/api/me" })).json().user).toBeNull();
    expect((await app.inject({ method: "GET", url: "/api/me/accounts" })).statusCode).toBe(401);
    const me = await app.inject({
      method: "GET",
      url: "/api/me",
      headers: { cookie: activeCookie },
    });
    expect(me.json().user).toMatchObject({ handle, status: "active", role: "user" });
  });

  it("reports handle availability and validates onboarding", async () => {
    const get = (value: string) =>
      app.inject({
        method: "GET",
        url: `/api/me/handle-availability?handle=${value}`,
        headers: { cookie: pendingCookie },
      });
    expect((await get(handle)).json()).toEqual({ available: false, reason: "taken" });
    expect((await get("admin")).json()).toEqual({ available: false, reason: "reserved" });
    expect((await get(`free_${stamp}`)).json()).toEqual({ available: true, reason: null });
    const onboard = await app.inject({
      method: "POST",
      url: "/api/me/onboarding",
      headers: { ...headers, cookie: pendingCookie },
      payload: { handle: `joined_${stamp}`, name: "New Member" },
    });
    expect(onboard.statusCode, onboard.body).toBe(200);
    expect(onboard.json().profile).toMatchObject({ name: "New Member", handle: `joined_${stamp}` });
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/me/onboarding",
          headers: { ...headers, cookie: pendingCookie },
          payload: { handle: `again_${stamp}`, name: "Again" },
        })
      ).statusCode,
    ).toBe(409);
  });

  it("updates the name and enforces the 30 day handle interval", async () => {
    const patch = (payload: object) =>
      app.inject({
        method: "PATCH",
        url: "/api/me/profile",
        headers: { ...headers, cookie: activeCookie },
        payload,
      });
    expect((await patch({ name: "  New Name  " })).json().profile.name).toBe("New Name");
    expect((await patch({ handle: `next_${stamp}` })).statusCode).toBe(409);
    await app.db
      .update(schema.users)
      .set({ handleChangedAt: new Date(Date.now() - 31 * 86_400_000) })
      .where(eq(schema.users.id, userId));
    expect((await patch({ handle: `next_${stamp}` })).json().profile.handle).toBe(`next_${stamp}`);
    expect((await patch({ name: "" })).statusCode).toBe(400);
  });

  it("lists linked accounts and preserves the last login method", async () => {
    const list = () =>
      app.inject({ method: "GET", url: "/api/me/accounts", headers: { cookie: activeCookie } });
    const first = (await list()).json().accounts[0];
    expect(first.providerId).toBe("dev");
    expect(
      (
        await app.inject({
          method: "DELETE",
          url: `/api/me/accounts/${first.id}`,
          headers: { ...headers, cookie: activeCookie },
        })
      ).statusCode,
    ).toBe(400);
    const [second] = await app.db
      .insert(schema.accounts)
      .values({
        userId,
        providerId: "google",
        accountId: `test-${stamp}`,
        displayName: "Test Google",
      })
      .returning({ id: schema.accounts.id });
    expect((await list()).json().accounts).toHaveLength(2);
    expect(
      (
        await app.inject({
          method: "DELETE",
          url: `/api/me/accounts/${second!.id}`,
          headers: { ...headers, cookie: activeCookie },
        })
      ).statusCode,
    ).toBe(200);
    expect((await list()).json().accounts).toHaveLength(1);
  });

  it("stores and removes an uploaded avatar", async () => {
    const uploaded = await app.inject({
      method: "PUT",
      url: "/api/me/avatar",
      headers: { ...headers, cookie: activeCookie, "content-type": "image/png" },
      payload: png,
    });
    expect(uploaded.statusCode, uploaded.body).toBe(200);
    expect(uploaded.json().image).toContain("/avatars/");
    const removed = await app.inject({
      method: "DELETE",
      url: "/api/me/avatar",
      headers: { ...headers, cookie: activeCookie },
    });
    expect(removed.statusCode).toBe(204);
    expect(
      (
        await app.inject({ method: "GET", url: "/api/me", headers: { cookie: activeCookie } })
      ).json().user.image,
    ).toBeNull();
  });
});
