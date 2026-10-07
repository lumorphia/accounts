import { createHash, randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { eq, schema } from "@lumorphia-accounts/db";
import {
  FakeLodestoneSource,
  fakeLodestoneCharacter,
} from "@lumorphia-accounts/core/adapters/lodestone";
import { MemoryJobQueue } from "@lumorphia-accounts/core/jobs";
import { buildApp } from "../app.ts";
import { loadEnv } from "../env.ts";
import { registerServiceClient } from "../auth/oidc-clients.ts";

const databaseUrl = process.env.DATABASE_URL;
const origin = "https://accounts.lumorphia.test:3443";
const headers = { host: new URL(origin).host, origin, "x-forwarded-proto": "https" };
const redirectUri = "https://scenote.lumorphia.test/api/auth/callback/lumorphia";
const lodestone = new FakeLodestoneSource([
  fakeLodestoneCharacter({ lodestoneId: "15022394", name: "Hal Myth" }),
  fakeLodestoneCharacter({ lodestoneId: "2" }),
]);
const jobs = new MemoryJobQueue();
function cookiesOf(res: { headers: Record<string, unknown> }) {
  const raw = res.headers["set-cookie"];
  return (Array.isArray(raw) ? raw : [String(raw)]).map((v) => String(v).split(";")[0]).join("; ");
}

describe.skipIf(!databaseUrl)("character routes (PostgreSQL)", () => {
  let app: FastifyInstance;
  let disabled: FastifyInstance;
  let cookie: string;
  let otherCookie: string;
  let pendingCookie: string;
  let userId: string;
  let characterId: string;
  let client: { client_id: string; client_secret: string };
  let accessToken: string;
  const env = () =>
    loadEnv({
      NODE_ENV: "test",
      DATABASE_URL: databaseUrl,
      AUTH_BASE_URL: origin,
      LOG_LEVEL: "silent",
      FEATURE_LODESTONE: "1",
    });
  const call = (
    method: "GET" | "POST" | "PUT" | "DELETE",
    path = "",
    payload?: object,
    session = cookie,
  ) =>
    app.inject({
      method,
      url: `/api/me/characters${path}`,
      headers: { ...headers, cookie: session },
      ...(payload ? { payload } : {}),
    });
  beforeAll(async () => {
    app = await buildApp({ env: env(), lodestone, characterJobs: jobs });
    disabled = await buildApp({
      env: { ...env(), FEATURE_LODESTONE: false },
      lodestone,
      characterJobs: jobs,
    });
    await app.ready();
    await disabled.ready();
    const login = async (onboarded = true) =>
      app.inject({
        method: "POST",
        url: "/api/auth/dev/login",
        headers,
        payload: { handle: `c_${randomBytes(6).toString("hex")}`, onboarded },
      });
    const owner = await login();
    cookie = cookiesOf(owner);
    userId = owner.json().userId;
    otherCookie = cookiesOf(await login());
    pendingCookie = cookiesOf(await login(false));
    await app.db.update(schema.users).set({ role: "admin" }).where(eq(schema.users.id, userId));
    client = (await registerServiceClient(app.auth, new Headers({ cookie }), {
      service: "scenote",
      redirectUri,
    })) as typeof client;
  });
  afterAll(async () => {
    await disabled?.close();
    await app?.close();
  });

  async function mint(scope = "openid lumorphia:characters", session = cookie) {
    const verifier = randomBytes(32).toString("base64url");
    const query = new URLSearchParams({
      client_id: client.client_id,
      redirect_uri: redirectUri,
      response_type: "code",
      scope,
      code_challenge: createHash("sha256").update(verifier).digest("base64url"),
      code_challenge_method: "S256",
    });
    const authorization = await app.inject({
      method: "GET",
      url: `/api/auth/oauth2/authorize?${query}`,
      headers: {
        ...headers,
        cookie: session,
        "sec-fetch-mode": "navigate",
        "sec-fetch-dest": "document",
      },
    });
    const code = new URL(String(authorization.headers.location)).searchParams.get("code")!;
    const res = await app.inject({
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
        code,
        code_verifier: verifier,
      }).toString(),
    });
    expect(res.statusCode, res.body).toBe(200);
    return res.json() as { access_token: string; id_token: string };
  }
  const service = (token?: string, extra = "") =>
    app.inject({
      method: "GET",
      url: `/api/characters${extra}`,
      headers: token ? { authorization: `Bearer ${token}` } : { cookie },
    });

  it("requires an active session for owner operations", async () => {
    expect((await call("GET", "", undefined, "")).statusCode).toBe(401);
    expect((await call("GET", "", undefined, pendingCookie)).statusCode).toBe(403);
  });
  it("registers a character and returns the ownership instructions only to its owner", async () => {
    const res = await call("POST", "", {
      lodestone: "https://jp.finalfantasyxiv.com/lodestone/character/15022394/",
    });
    expect(res.statusCode, res.body).toBe(201);
    const character = res.json().character;
    characterId = character.id;
    expect(character).toMatchObject({ name: "Hal Myth", verified: false, isPrimary: true });
    expect(character.verification.token).toMatch(/^lumorphia-[a-f0-9]{8}$/);
    expect((await call("GET")).json().characters).toHaveLength(1);
    expect((await call("GET", "", undefined, otherCookie)).json().characters).toEqual([]);
  });
  it("rejects invalid registration input before fetching", async () => {
    const count = lodestone.calls.length;
    expect(
      (await call("POST", "", { lodestone: "", name: "Hal Myth", world: "Tiamat" })).statusCode,
    ).toBe(400);
    expect((await call("POST", "", { lodestone: "invalid" })).statusCode).toBe(400);
    expect(lodestone.calls).toHaveLength(count);
  });
  it.each(["verify", "token", "sync", "primary"])(
    "denies another owner's %s operation",
    async (operation) => {
      expect(
        (
          await call(
            operation === "primary" ? "PUT" : "POST",
            `/${characterId}/${operation}`,
            undefined,
            otherCookie,
          )
        ).statusCode,
      ).toBe(404);
    },
  );
  it("denies deleting another owner's character", async () => {
    expect((await call("DELETE", `/${characterId}`, undefined, otherCookie)).statusCode).toBe(404);
  });
  it("reissues a token and verifies the exact self introduction token", async () => {
    const old = (await call("GET")).json().characters[0].verification.token;
    const reissued = await call("POST", `/${characterId}/token`);
    expect(reissued.statusCode, reissued.body).toBe(200);
    const token = reissued.json().character.verification.token;
    expect(token).not.toBe(old);
    expect((await call("POST", `/${characterId}/verify`)).json().result).toBe("token_not_found");
    lodestone.setSelfIntroduction("15022394", token);
    const verified = await call("POST", `/${characterId}/verify`);
    expect(verified.json()).toMatchObject({
      result: "verified",
      character: { verified: true, verification: null },
    });
  });
  it("enqueues a manual sync once after the daily interval", async () => {
    expect((await call("POST", `/${characterId}/sync`)).statusCode).toBe(429);
    await app.db
      .update(schema.characters)
      .set({ lastSyncedAt: new Date(Date.now() - 2 * 86_400_000) })
      .where(eq(schema.characters.id, characterId));
    expect((await call("POST", `/${characterId}/sync`)).statusCode).toBe(202);
    expect(jobs.jobs.at(-1)).toMatchObject({ name: "character-sync", data: { characterId } });
    expect((await call("POST", `/${characterId}/sync`)).statusCode).toBe(429);
  });
  it("lists only verified characters with an explicit service scope and no private fields", async () => {
    expect((await call("POST", "", { name: "Test Character", world: "Tiamat" })).statusCode).toBe(
      201,
    );
    accessToken = (await mint()).access_token;
    const res = await service(accessToken);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.json().characters).toHaveLength(1);
    expect(res.json().characters[0]).toMatchObject({
      id: characterId,
      lodestoneId: "15022394",
      verified: true,
    });
    expect(Object.keys(res.json().characters[0]).sort()).toEqual(
      [
        "avatarUrl",
        "clan",
        "dataCenter",
        "gender",
        "id",
        "isPrimary",
        "lastSyncedAt",
        "lodestoneId",
        "name",
        "race",
        "verified",
        "verifiedAt",
        "world",
      ].sort(),
    );
    expect((await service(accessToken, `?userId=${crypto.randomUUID()}`)).statusCode).toBe(400);
  });
  it("binds the service list to the token owner without a Lodestone request", async () => {
    const count = lodestone.calls.length;
    const tokens = await mint("openid lumorphia:characters", otherCookie);
    expect((await service(tokens.access_token)).json().characters).toEqual([]);
    expect(lodestone.calls).toHaveLength(count);
  });

  it("refuses a cookie, invalid token, ID token and missing scope for service access", async () => {
    expect((await service()).statusCode).toBe(401);
    expect((await service("test-invalid")).statusCode).toBe(401);
    const tokens = await mint("openid profile");
    expect((await service(tokens.access_token)).statusCode).toBe(403);
    expect((await service(tokens.id_token)).statusCode).toBe(401);
  });
  it("denies service access immediately after suspension or client disabling", async () => {
    await app.db
      .update(schema.users)
      .set({ status: "suspended" })
      .where(eq(schema.users.id, userId));
    expect((await service(accessToken)).statusCode).toBe(403);
    await app.db.update(schema.users).set({ status: "active" }).where(eq(schema.users.id, userId));
    await app.db
      .update(schema.oauthClients)
      .set({ disabled: true })
      .where(eq(schema.oauthClients.clientId, client.client_id));
    expect((await service(accessToken)).statusCode).toBe(401);
    await app.db
      .update(schema.oauthClients)
      .set({ disabled: false })
      .where(eq(schema.oauthClients.clientId, client.client_id));
  });
  it("denies a revoked access token", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/oauth2/revoke",
      headers: {
        host: headers.host,
        "x-forwarded-proto": "https",
        "content-type": "application/x-www-form-urlencoded",
      },
      payload: new URLSearchParams({
        client_id: client.client_id,
        client_secret: client.client_secret,
        token: accessToken,
        token_type_hint: "access_token",
      }).toString(),
    });
    expect(res.statusCode, res.body).toBe(200);
    expect((await service(accessToken)).statusCode).toBe(401);
  });
  it("keeps listing, primary selection and deletion available while Lodestone is disabled", async () => {
    const request = (method: "GET" | "POST" | "PUT" | "DELETE", path = "", payload?: object) =>
      disabled.inject({
        method,
        url: `/api/me/characters${path}`,
        headers: { ...headers, cookie },
        ...(payload ? { payload } : {}),
      });
    expect((await request("GET")).json().enabled).toBe(false);
    expect((await request("POST", "", { lodestone: "3" })).statusCode).toBe(403);
    expect((await request("PUT", `/${characterId}/primary`)).statusCode).toBe(200);
    expect((await request("DELETE", `/${characterId}`)).statusCode).toBe(200);
    expect((await request("GET")).json().characters).toHaveLength(1);
  });
});
