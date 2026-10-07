import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createLocalJWKSet, jwtVerify } from "jose";
import type { FastifyInstance } from "fastify";
import { eq, schema } from "@lumorphia-accounts/db";
import { buildApp } from "../app.ts";
import { loadEnv } from "../env.ts";
import { registerServiceClient } from "../auth/oidc-clients.ts";
import { visitService } from "@lumorphia-accounts/core";
const url = process.env.DATABASE_URL;
const origin = "https://accounts.lumorphia.test:3443";
const headers = { host: new URL(origin).host, origin, "x-forwarded-proto": "https" };
const cookieOf = (raw: unknown) =>
  (Array.isArray(raw) ? raw : [String(raw)]).map((s) => String(s).split(";")[0]).join("; ");
describe.skipIf(!url)("account lifecycle HTTP (PostgreSQL)", () => {
  let app: FastifyInstance;
  let adminCookie: string;
  beforeAll(async () => {
    app = await buildApp({
      env: loadEnv({
        NODE_ENV: "test",
        DATABASE_URL: url,
        AUTH_BASE_URL: origin,
        LOG_LEVEL: "silent",
        FEATURE_ACCOUNT_LIFECYCLE: "1",
      }),
    });
    await app.ready();
    const admin = await login();
    adminCookie = admin.cookie;
    await app.db
      .update(schema.users)
      .set({ role: "admin" })
      .where(eq(schema.users.id, admin.userId));
    await registerServiceClient(app.auth, new Headers({ cookie: adminCookie }), {
      service: "scenote",
      redirectUri: "https://scenote.lumorphia.test/callback",
    });
  });
  afterAll(async () => {
    await app?.close();
  });
  async function login(handle = `ad_${randomBytes(5).toString("hex")}`) {
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/dev/login",
      headers,
      payload: { handle },
    });
    return {
      res,
      handle,
      userId: res.json().userId as string,
      cookie: cookieOf(res.headers["set-cookie"]),
    };
  }
  it("requires a session and same origin for deletion", async () => {
    expect((await app.inject({ method: "GET", url: "/api/me/lifecycle" })).statusCode).toBe(401);
    const user = await login();
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/me/deletion",
          headers: { cookie: user.cookie },
          payload: { confirm: user.handle },
        })
      ).statusCode,
    ).toBe(403);
  });
  it("invalidates every session and keeps the account deleted on a new login", async () => {
    const user = await login();
    const second = await login(user.handle);
    const deleted = await app.inject({
      method: "POST",
      url: "/api/me/deletion",
      headers: { ...headers, cookie: user.cookie },
      payload: { confirm: user.handle },
    });
    expect(deleted.statusCode, deleted.body).toBe(200);
    expect(
      (
        await app.inject({ method: "GET", url: "/api/me", headers: { cookie: second.cookie } })
      ).json().user,
    ).toBeNull();
    const again = await login(user.handle);
    expect(again.res.statusCode, again.res.body).toBe(200);
    expect(again.userId).toBe(user.userId);
    const me = (
      await app.inject({ method: "GET", url: "/api/me", headers: { cookie: again.cookie } })
    ).json().user;
    expect(me.status).toBe("deleted");
    expect(new Date(me.recoverUntil).getTime()).toBeGreaterThan(Date.now());
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/api/me/lifecycle",
          headers: { cookie: again.cookie },
        })
      ).statusCode,
    ).toBe(401);
  });
  it("restores a deleted account only when its owner asks", async () => {
    const user = await login();
    await app.inject({
      method: "POST",
      url: "/api/me/deletion",
      headers: { ...headers, cookie: user.cookie },
      payload: { confirm: user.handle },
    });
    const again = await login(user.handle);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/me/restore",
          headers: { cookie: again.cookie },
        })
      ).statusCode,
    ).toBe(403);
    const restored = await app.inject({
      method: "POST",
      url: "/api/me/restore",
      headers: { ...headers, cookie: again.cookie },
    });
    expect(restored.statusCode, restored.body).toBe(200);
    const me = (
      await app.inject({ method: "GET", url: "/api/me", headers: { cookie: again.cookie } })
    ).json().user;
    expect(me).toMatchObject({ status: "active", recoverUntil: null });
  });
  it("refuses a restore request for an active account", async () => {
    const user = await login();
    const res = await app.inject({
      method: "POST",
      url: "/api/me/restore",
      headers: { ...headers, cookie: user.cookie },
    });
    expect(res.statusCode).toBe(409);
  });
  it("requires a session to restore", async () => {
    expect((await app.inject({ method: "POST", url: "/api/me/restore", headers })).statusCode).toBe(
      401,
    );
  });
  it("refuses a new session after the recovery deadline", async () => {
    const user = await login();
    await app.inject({
      method: "POST",
      url: "/api/me/deletion",
      headers: { ...headers, cookie: user.cookie },
      payload: { confirm: user.handle },
    });
    await app.db
      .update(schema.users)
      .set({ deletedAt: new Date(Date.now() - 31 * 86_400_000) })
      .where(eq(schema.users.id, user.userId));
    const expired = await login(user.handle);
    expect(expired.res.statusCode).toBe(403);
    expect(
      await app.db.query.sessions.findMany({ where: eq(schema.sessions.userId, user.userId) }),
    ).toEqual([]);
  });
  it("deletes and restores a single service without logging out of Lumorphia", async () => {
    const user = await login();
    await visitService({ db: app.db }, user.userId, "scenote");
    const deleted = await app.inject({
      method: "POST",
      url: "/api/me/services/scenote/deletion",
      headers: { ...headers, cookie: user.cookie },
      payload: { confirm: user.handle },
    });
    expect(deleted.statusCode, deleted.body).toBe(200);
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/api/me/lifecycle",
          headers: { cookie: user.cookie },
        })
      ).json().services[0].state,
    ).toBe("deleted");
    const restored = await app.inject({
      method: "POST",
      url: "/api/me/services/scenote/restore",
      headers: { ...headers, cookie: user.cookie },
    });
    expect(restored.statusCode, restored.body).toBe(200);
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/api/me/lifecycle",
          headers: { cookie: user.cookie },
        })
      ).json().services[0].state,
    ).toBe("active");
  });
  it("protects administrators from global deletion", async () => {
    const user = (
      await app.inject({ method: "GET", url: "/api/me", headers: { cookie: adminCookie } })
    ).json().user;
    const res = await app.inject({
      method: "POST",
      url: "/api/me/deletion",
      headers: { ...headers, cookie: adminCookie },
      payload: { confirm: user.handle },
    });
    expect(res.statusCode).toBe(403);
  });
  it("signs a dedicated short lived event with the persisted OIDC key", async () => {
    const user = await login();
    await visitService({ db: app.db }, user.userId, "scenote");
    await app.inject({
      method: "POST",
      url: "/api/me/services/scenote/deletion",
      headers: { ...headers, cookie: user.cookie },
      payload: { confirm: user.handle },
    });
    const row = (
      await app.db.query.accountEvents.findMany({
        where: eq(schema.accountEvents.sub, user.userId),
      })
    )[0]!;
    const signed = await app.auth.api.signAccountEvent({
      body: {
        aud: row.clientId,
        sub: row.sub,
        jti: row.id,
        lifecycle: {
          service: row.service,
          revision: row.revision,
          state: row.state,
          scope: row.scope,
          occurredAt: row.occurredAt.toISOString(),
          deletedAt: row.deletedAt!.toISOString(),
          recoverUntil: row.recoverUntil!.toISOString(),
        },
      },
    });
    const jwks = (await app.inject({ method: "GET", url: "/api/auth/jwks", headers })).json();
    const { payload } = await jwtVerify(signed.token, createLocalJWKSet(jwks), {
      issuer: `${origin}/api/auth`,
      audience: row.clientId,
      typ: "lumorphia-account-event+jwt",
      algorithms: ["EdDSA"],
    });
    expect(payload.exp! - payload.iat!).toBe(120);
    expect(payload.jti).toBe(row.id);
  });
});
