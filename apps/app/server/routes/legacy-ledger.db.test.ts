import { createHash, randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createLocalJWKSet, jwtVerify } from "jose";
import type { FastifyInstance } from "fastify";
import { eq, schema } from "@lumorphia-accounts/db";
import { importLegacyLedger } from "@lumorphia-accounts/core";
import { buildApp } from "../app.ts";
import { loadEnv } from "../env.ts";
import { registerServiceClient } from "../auth/oidc-clients.ts";
const url = process.env.DATABASE_URL;
const origin = "https://accounts.lumorphia.test:3443";
const headers = { host: new URL(origin).host, origin, "x-forwarded-proto": "https" };
const path = "/api/legacy/prismtone/complete";
const cookies = (raw: unknown) =>
  (Array.isArray(raw) ? raw : [String(raw)]).map((v) => String(v).split(";")[0]).join("; ");
type Client = { client_id: string; client_secret: string };
describe.skipIf(!url)("legacy ledger HTTP (PostgreSQL)", () => {
  let app: FastifyInstance, cookie: string, userId: string, prismtone: Client, scenote: Client;
  const stamp = randomUUID().slice(0, 8),
    legacyId = randomUUID(),
    oldHandle = `old_${stamp}`;
  beforeAll(async () => {
    app = await buildApp({
      env: loadEnv({
        NODE_ENV: "test",
        DATABASE_URL: url,
        AUTH_BASE_URL: origin,
        AUTH_SECRET: "test-secret-test-secret-test-secret-1234",
        LOG_LEVEL: "silent",
      }),
    });
    await app.ready();
    await app.db.delete(schema.legacyAccounts);
    await app.db.delete(schema.legacyImports);
    const login = await app.inject({
      method: "POST",
      url: "/api/auth/dev/login",
      headers,
      payload: { handle: `lh_${stamp}` },
    });
    cookie = cookies(login.headers["set-cookie"]);
    userId = login.json().userId;
    await app.db.update(schema.users).set({ role: "admin" }).where(eq(schema.users.id, userId));
    prismtone = (await registerServiceClient(app.auth, new Headers({ cookie }), {
      service: "prismtone",
      redirectUri: "https://prismtone.lumorphia.test/callback",
    })) as Client;
    scenote = (await registerServiceClient(app.auth, new Headers({ cookie }), {
      service: "scenote",
      redirectUri: "https://scenote.lumorphia.test/callback",
    })) as Client;
    await app.db
      .insert(schema.accounts)
      .values({ userId, providerId: "discord", accountId: `test-legacy-${stamp}` });
    await importLegacyLedger(app.db, {
      service: "prismtone",
      accounts: [
        {
          legacyUserId: legacyId,
          handle: oldHandle,
          identities: [{ providerId: "discord", accountId: `test-legacy-${stamp}` }],
        },
      ],
    });
  });
  afterAll(async () => {
    await app?.close();
  });
  async function mint(client = prismtone, scope = "openid profile email lumorphia:legacy") {
    const redirect =
      client === prismtone
        ? "https://prismtone.lumorphia.test/callback"
        : "https://scenote.lumorphia.test/callback";
    const verifier = randomBytes(32).toString("base64url");
    const query = new URLSearchParams({
      client_id: client.client_id,
      redirect_uri: redirect,
      response_type: "code",
      scope,
      nonce: "test-nonce",
      state: "test-state",
      code_challenge: createHash("sha256").update(verifier).digest("base64url"),
      code_challenge_method: "S256",
    });
    const auth = await app.inject({
      method: "GET",
      url: `/api/auth/oauth2/authorize?${query}`,
      headers: { ...headers, cookie, "sec-fetch-mode": "navigate", "sec-fetch-dest": "document" },
    });
    expect(auth.statusCode, auth.body).toBe(302);
    const code = new URL(String(auth.headers.location)).searchParams.get("code")!;
    const token = await app.inject({
      method: "POST",
      url: "/api/auth/oauth2/token",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      payload: new URLSearchParams({
        client_id: client.client_id,
        client_secret: client.client_secret,
        grant_type: "authorization_code",
        code,
        code_verifier: verifier,
        redirect_uri: redirect,
      }).toString(),
    });
    expect(token.statusCode, token.body).toBe(200);
    return token.json() as { access_token: string; id_token: string };
  }
  const complete = (token?: string, payload = { legacyUserId: legacyId, handleChoice: "legacy" }) =>
    app.inject({
      method: "POST",
      url: path,
      headers: token ? { authorization: `Bearer ${token}` } : { cookie },
      payload,
    });
  it("shows only the signed in user's migration notice without provider identities or legacy IDs", async () => {
    expect((await app.inject({ method: "GET", url: "/api/me/legacy" })).statusCode).toBe(401);
    const res = await app.inject({ method: "GET", url: "/api/me/legacy", headers: { cookie } });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.json()).toEqual({
      accounts: [
        {
          service: "prismtone",
          handle: oldHandle,
          migrationUrl: "https://prismtone.lumorphia.com/settings/migration",
        },
      ],
    });
  });
  it("requires an access token instead of accepting the browser cookie on the server endpoint", async () => {
    expect((await complete()).statusCode).toBe(401);
    expect((await complete("test-invalid")).statusCode).toBe(401);
  });
  it("refuses completion without the explicit migration scope", async () => {
    const token = await mint(prismtone, "openid profile email");
    expect((await complete(token.access_token)).statusCode).toBe(403);
  });
  it("refuses another registered service's access token", async () => {
    const token = await mint(scenote, "openid profile email");
    expect((await complete(token.access_token)).statusCode).toBe(401);
  });
  it("includes the pending service in a verified ID token and current UserInfo", async () => {
    const tokens = await mint();
    const jwks = (await app.inject({ method: "GET", url: "/api/auth/jwks" })).json();
    const { payload } = await jwtVerify(tokens.id_token, createLocalJWKSet(jwks), {
      issuer: `${origin}/api/auth`,
      audience: prismtone.client_id,
      algorithms: ["EdDSA"],
    });
    expect(payload["https://lumorphia.com/legacy_pending"]).toEqual(["prismtone"]);
    const info = await app.inject({
      method: "GET",
      url: "/api/auth/oauth2/userinfo",
      headers: { authorization: `Bearer ${tokens.access_token}` },
    });
    expect(info.json()["https://lumorphia.com/legacy_pending"]).toEqual(["prismtone"]);
  });
  it("does not allow the caller to replace the token subject", async () => {
    const tokens = await mint();
    const res = await app.inject({
      method: "POST",
      url: path,
      headers: { authorization: `Bearer ${tokens.access_token}` },
      payload: { legacyUserId: legacyId, handleChoice: "legacy", sub: randomUUID() },
    });
    expect(res.statusCode).toBe(400);
  });
  it("records matching migration idempotently and updates current UserInfo immediately", async () => {
    const tokens = await mint();
    const result = await complete(tokens.access_token);
    expect(result.statusCode, result.body).toBe(200);
    expect(result.json()).toEqual({ handle: oldHandle, alreadyCompleted: false });
    expect((await complete(tokens.access_token)).json()).toEqual({
      handle: oldHandle,
      alreadyCompleted: true,
    });
    const info = await app.inject({
      method: "GET",
      url: "/api/auth/oauth2/userinfo",
      headers: { authorization: `Bearer ${tokens.access_token}` },
    });
    expect(info.json()["https://lumorphia.com/legacy_pending"]).toEqual([]);
    expect(info.json()["https://lumorphia.com/handle"]).toBe(oldHandle);
    expect(
      (await app.inject({ method: "GET", url: "/api/me/legacy", headers: { cookie } })).json(),
    ).toEqual({ accounts: [] });
  });
});
