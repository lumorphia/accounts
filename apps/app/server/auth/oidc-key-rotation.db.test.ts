import { createHash, randomBytes } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createLocalJWKSet, decodeProtectedHeader, jwtVerify, type JSONWebKeySet } from "jose";
import type { FastifyInstance } from "fastify";
import { eq, schema } from "@lumorphia-accounts/db";
import { buildApp } from "../app.ts";
import { loadEnv } from "../env.ts";
import { registerServiceClient } from "./oidc-clients.ts";

const databaseUrl = process.env.DATABASE_URL;
const origin = "https://accounts.lumorphia.test:3443";
const redirectUri = "https://prismtone.lumorphia.test/api/auth/callback/lumorphia";
const headers = { host: new URL(origin).host, origin, "x-forwarded-proto": "https" };
const day = 86_400_000;
const startedAt = new Date();
const handle = `key_${randomBytes(5).toString("hex")}`;

// Date だけを差し替える。PostgreSQL の接続と Fastify の処理は実際に動かす。
describe.skipIf(!databaseUrl)("OIDC signing key rotation (PostgreSQL)", () => {
  let app: FastifyInstance;
  let client: { client_id: string; client_secret: string };
  let userId: string;
  const env = () =>
    loadEnv({
      NODE_ENV: "test",
      DATABASE_URL: databaseUrl,
      AUTH_BASE_URL: origin,
      AUTH_SECRET: "test-secret-test-secret-test-secret-1234",
      LOG_LEVEL: "silent",
    });

  async function login() {
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/dev/login",
      headers,
      payload: { handle },
    });
    expect(res.statusCode, res.body).toBe(200);
    const raw = res.headers["set-cookie"];
    const cookie = (Array.isArray(raw) ? raw : raw ? [String(raw)] : [])
      .map((value) => value.split(";")[0])
      .join("; ");
    return { cookie, userId: res.json().userId as string };
  }

  beforeAll(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(startedAt);
    app = await buildApp({ env: env() });
    await app.ready();
    const session = await login();
    userId = session.userId;
    await app.db.update(schema.users).set({ role: "admin" }).where(eq(schema.users.id, userId));
    client = (await registerServiceClient(app.auth, new Headers({ cookie: session.cookie }), {
      service: "prismtone",
      redirectUri,
    })) as typeof client;
  });
  beforeEach(async () => {
    vi.setSystemTime(startedAt);
    // このファイル専用の DB の鍵だけを空にして、各テストを独立させる。
    await app.db.delete(schema.jwks);
  });
  afterAll(async () => {
    vi.useRealTimers();
    await app?.close();
  });

  async function keys(): Promise<JSONWebKeySet> {
    const res = await app.inject({ method: "GET", url: "/api/auth/jwks", headers });
    expect(res.statusCode, res.body).toBe(200);
    return res.json();
  }

  async function issue() {
    // 90 日進めると元のセッションは期限切れになるため、認可の前にログインし直す。
    const { cookie } = await login();
    const verifier = randomBytes(32).toString("base64url");
    const nonce = `test-${randomBytes(8).toString("hex")}`;
    const params = new URLSearchParams({
      client_id: client.client_id,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: "openid profile",
      state: "test-state",
      nonce,
      code_challenge: createHash("sha256").update(verifier).digest("base64url"),
      code_challenge_method: "S256",
    });
    const authorized = await app.inject({
      method: "GET",
      url: `/api/auth/oauth2/authorize?${params}`,
      headers: { ...headers, cookie, "sec-fetch-mode": "navigate", "sec-fetch-dest": "document" },
    });
    expect(authorized.statusCode, authorized.body).toBe(302);
    const callback = new URL(String(authorized.headers.location), origin);
    expect(callback.origin).toBe(new URL(redirectUri).origin);
    const exchanged = await app.inject({
      method: "POST",
      url: "/api/auth/oauth2/token",
      headers: {
        host: headers.host,
        "x-forwarded-proto": "https",
        "content-type": "application/x-www-form-urlencoded",
      },
      payload: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: client.client_id,
        client_secret: client.client_secret,
        redirect_uri: redirectUri,
        code: callback.searchParams.get("code")!,
        code_verifier: verifier,
      }).toString(),
    });
    expect(exchanged.statusCode, exchanged.body).toBe(200);
    return { token: exchanged.json().id_token as string, nonce };
  }

  async function verify(issued: Awaited<ReturnType<typeof issue>>, jwks: JSONWebKeySet) {
    const { payload } = await jwtVerify(issued.token, createLocalJWKSet(jwks), {
      issuer: `${origin}/api/auth`,
      audience: client.client_id,
      algorithms: ["EdDSA"],
      currentDate: new Date(),
    });
    expect(payload.sub).toBe(userId);
    expect(payload.nonce).toBe(issued.nonce);
    expect(payload["https://lumorphia.com/handle"]).toBe(handle);
  }

  it("persists an encrypted Ed25519 key with a ninety day signing lifetime", async () => {
    const jwks = await keys();
    const row = await app.db.query.jwks.findFirst();
    expect(row).toBeDefined();
    expect(row!.expiresAt!.getTime() - row!.createdAt.getTime()).toBe(90 * day);
    expect(jwks.keys[0]).toMatchObject({ kid: row!.id, alg: "EdDSA", crv: "Ed25519", kty: "OKP" });
    expect(jwks.keys.every((key) => !("d" in key))).toBe(true);
    expect(typeof JSON.parse(row!.privateKey)).toBe("string");
    expect("d" in JSON.parse(row!.publicKey)).toBe(false);
    await verify(await issue(), jwks);
  });

  it("does not rotate a signing key when only JWKS is read after expiry", async () => {
    const initial = await keys();
    vi.setSystemTime(startedAt.getTime() + 90 * day);
    expect((await keys()).keys.map((key) => key.kid)).toEqual([initial.keys[0]!.kid]);
    expect(await app.db.query.jwks.findMany({ columns: { id: true } })).toHaveLength(1);
  });

  it("keeps the same signing key before its ninety day deadline", async () => {
    const initial = await keys();
    vi.setSystemTime(startedAt.getTime() + 90 * day - 1);
    const issued = await issue();
    expect(decodeProtectedHeader(issued.token).kid).toBe(initial.keys[0]!.kid);
    expect((await keys()).keys).toHaveLength(1);
    await verify(issued, await keys());
  });

  it("rotates at expiry and verifies still valid tokens signed by both keys", async () => {
    const initial = await keys();
    vi.setSystemTime(startedAt.getTime() + 90 * day - 60_000);
    const previous = await issue();
    vi.setSystemTime(startedAt.getTime() + 90 * day);
    const current = await issue();
    expect(decodeProtectedHeader(current.token).kid).not.toBe(initial.keys[0]!.kid);
    const rotated = await keys();
    expect(rotated.keys).toHaveLength(2);
    await verify(previous, rotated);
    await verify(current, rotated);
  });

  it("publishes the retired public key until just before the seven day grace deadline", async () => {
    const initial = await keys();
    vi.setSystemTime(startedAt.getTime() + 90 * day);
    await issue();
    vi.setSystemTime(startedAt.getTime() + 97 * day - 1);
    expect((await keys()).keys.map((key) => key.kid)).toContain(initial.keys[0]!.kid);
  });

  it("removes the retired public key from JWKS at the grace deadline", async () => {
    await keys();
    vi.setSystemTime(startedAt.getTime() + 90 * day);
    const current = await issue();
    vi.setSystemTime(startedAt.getTime() + 97 * day);
    const published = await keys();
    expect(published.keys.map((key) => key.kid)).toEqual([
      decodeProtectedHeader(current.token).kid,
    ]);
    // JWKS の公開終了と DB からの物理削除は別。古い鍵の行は残る。
    expect(await app.db.query.jwks.findMany({ columns: { id: true } })).toHaveLength(2);
  });

  it("reuses the persisted signing key after an application restart", async () => {
    const initial = await keys();
    const previous = await issue();
    await app.close();
    app = await buildApp({ env: env() });
    await app.ready();
    const current = await issue();
    expect(decodeProtectedHeader(current.token).kid).toBe(initial.keys[0]!.kid);
    const persisted = await keys();
    expect(persisted.keys).toHaveLength(1);
    await verify(previous, persisted);
    await verify(current, persisted);
  });
});
