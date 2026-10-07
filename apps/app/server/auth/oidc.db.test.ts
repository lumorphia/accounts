import { createHash, randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createLocalJWKSet, jwtVerify } from "jose";
import type { FastifyInstance } from "fastify";
import { eq, schema } from "@lumorphia-accounts/db";
import { buildApp } from "../app.ts";
import { loadEnv } from "../env.ts";
import { lumorphiaClaims } from "./oidc.ts";
import { registerServiceClient } from "./oidc-clients.ts";

const databaseUrl = process.env.DATABASE_URL;
const origin = "https://accounts.lumorphia.test:3443";
const redirectUri = "https://prismtone.lumorphia.test/api/auth/callback/lumorphia";
const headers = { host: "accounts.lumorphia.test:3443", origin, "x-forwarded-proto": "https" };
const stamp = crypto.randomUUID().slice(0, 8);
function cookiesOf(res: { headers: Record<string, unknown> }) {
  const raw = res.headers["set-cookie"];
  return (Array.isArray(raw) ? raw : raw ? [String(raw)] : [])
    .map((value) => String(value).split(";")[0])
    .join("; ");
}

describe.skipIf(!databaseUrl)("OIDC provider (PostgreSQL)", () => {
  let app: FastifyInstance;
  let cookie: string;
  let userId: string;
  let client: { client_id: string; client_secret: string };
  let scenote: { client_id: string; client_secret: string };

  beforeAll(async () => {
    app = await buildApp({
      env: loadEnv({
        NODE_ENV: "test",
        DATABASE_URL: databaseUrl,
        AUTH_BASE_URL: origin,
        AUTH_SECRET: "test-secret-test-secret-test-secret-1234",
        LOG_LEVEL: "silent",
      }),
    });
    await app.ready();
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/dev/login",
      headers,
      payload: { handle: `oidc_${stamp}` },
    });
    expect(res.statusCode, res.body).toBe(200);
    cookie = cookiesOf(res);
    const me = await app.inject({ method: "GET", url: "/api/me", headers: { cookie } });
    userId = me.json().user.id;
    await app.db.update(schema.users).set({ role: "admin" }).where(eq(schema.users.id, userId));
    client = (await registerServiceClient(app.auth, new Headers({ cookie }), {
      service: "prismtone",
      redirectUri,
    })) as typeof client;
    scenote = (await registerServiceClient(app.auth, new Headers({ cookie }), {
      service: "scenote",
      redirectUri: "https://scenote.lumorphia.test/api/auth/callback/lumorphia",
    })) as typeof scenote;
    await app.db
      .insert(schema.accounts)
      .values({ userId, providerId: "discord", accountId: `test-discord-${stamp}` });
  });
  afterAll(async () => {
    await app?.close();
  });

  async function authorize(
    scope = "openid profile email lumorphia:identities",
    clientId = client.client_id,
    redirect = redirectUri,
  ) {
    const verifier = randomBytes(32).toString("base64url");
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirect,
      response_type: "code",
      scope,
      state: "test-state",
      nonce: "test-nonce",
      code_challenge: createHash("sha256").update(verifier).digest("base64url"),
      code_challenge_method: "S256",
    });
    const res = await app.inject({
      method: "GET",
      url: `/api/auth/oauth2/authorize?${params}`,
      headers: { ...headers, cookie, "sec-fetch-mode": "navigate", "sec-fetch-dest": "document" },
    });
    return { res, verifier };
  }
  async function token(code: string, verifier: string) {
    return app.inject({
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
  }

  it("sends a pending account to onboarding and resumes authorization afterwards", async () => {
    await app.db.update(schema.users).set({ status: "pending" }).where(eq(schema.users.id, userId));
    try {
      const { res, verifier } = await authorize();
      expect(res.statusCode, res.body).toBe(302);
      const welcome = new URL(String(res.headers.location), origin);
      expect(welcome.pathname).toBe("/welcome");
      expect(welcome.searchParams.get("sig")).toBeTruthy();
      await app.db
        .update(schema.users)
        .set({ status: "active" })
        .where(eq(schema.users.id, userId));
      const resumed = await app.inject({
        method: "GET",
        url: `/api/auth/oauth2/authorize${welcome.search}`,
        headers: { ...headers, cookie, "sec-fetch-mode": "navigate", "sec-fetch-dest": "document" },
      });
      expect(resumed.statusCode, resumed.body).toBe(302);
      const callback = new URL(String(resumed.headers.location));
      expect(callback.searchParams.get("state")).toBe("test-state");
      expect((await token(callback.searchParams.get("code")!, verifier)).statusCode).toBe(200);
    } finally {
      await app.db
        .update(schema.users)
        .set({ status: "active" })
        .where(eq(schema.users.id, userId));
    }
  });

  async function setServiceDeletedAt(deletedAt: Date | null) {
    await app.db
      .insert(schema.serviceMemberships)
      .values({ userId, service: "prismtone", deletedAt })
      .onConflictDoUpdate({
        target: [schema.serviceMemberships.userId, schema.serviceMemberships.service],
        set: { deletedAt, purgedAt: null },
      });
  }
  async function resume(next: string) {
    return app.inject({
      method: "GET",
      url: next,
      headers: { ...headers, cookie, "sec-fetch-mode": "navigate", "sec-fetch-dest": "document" },
    });
  }

  it("sends a deleted account to the dashboard to choose recovery before authorizing", async () => {
    await app.db
      .update(schema.users)
      .set({ status: "deleted", deletedAt: new Date() })
      .where(eq(schema.users.id, userId));
    try {
      const { res, verifier } = await authorize();
      expect(res.statusCode, res.body).toBe(302);
      const dashboard = new URL(String(res.headers.location), origin);
      expect(dashboard.origin).toBe(origin);
      expect(dashboard.pathname).toBe("/");
      expect(dashboard.searchParams.get("service")).toBeNull();
      const next = dashboard.searchParams.get("next")!;
      expect(next.startsWith("/api/auth/oauth2/authorize?")).toBe(true);
      await app.db
        .update(schema.users)
        .set({ status: "active", deletedAt: null })
        .where(eq(schema.users.id, userId));
      const resumed = await resume(next);
      expect(resumed.statusCode, resumed.body).toBe(302);
      const callback = new URL(String(resumed.headers.location));
      expect(callback.searchParams.get("state")).toBe("test-state");
      expect((await token(callback.searchParams.get("code")!, verifier)).statusCode).toBe(200);
    } finally {
      await app.db
        .update(schema.users)
        .set({ status: "active", deletedAt: null })
        .where(eq(schema.users.id, userId));
    }
  });

  it("sends a deleted service membership to the dashboard instead of restoring it on login", async () => {
    await setServiceDeletedAt(new Date());
    try {
      const { res } = await authorize();
      expect(res.statusCode, res.body).toBe(302);
      const dashboard = new URL(String(res.headers.location), origin);
      expect(dashboard.pathname).toBe("/");
      expect(dashboard.searchParams.get("service")).toBe("prismtone");
      expect(dashboard.searchParams.get("next")?.startsWith("/api/auth/oauth2/authorize?")).toBe(
        true,
      );
      const membership = await app.db.query.serviceMemberships.findFirst({
        where: eq(schema.serviceMemberships.userId, userId),
      });
      expect(membership?.deletedAt).not.toBeNull();
    } finally {
      await setServiceDeletedAt(null);
    }
  });

  it("refuses to issue tokens for a service deleted after the code was granted", async () => {
    const { res, verifier } = await authorize();
    const code = new URL(String(res.headers.location)).searchParams.get("code")!;
    await setServiceDeletedAt(new Date());
    try {
      const exchanged = await token(code, verifier);
      expect(exchanged.statusCode).not.toBe(200);
      expect(exchanged.json().id_token).toBeUndefined();
    } finally {
      await setServiceDeletedAt(null);
    }
  });

  it("publishes discovery and public signing keys", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/auth/.well-known/openid-configuration",
      headers,
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({
      issuer: `${origin}/api/auth`,
      authorization_endpoint: `${origin}/api/auth/oauth2/authorize`,
      token_endpoint: `${origin}/api/auth/oauth2/token`,
      code_challenge_methods_supported: ["S256"],
    });
    const keys = await app.inject({ method: "GET", url: "/api/auth/jwks", headers });
    expect(keys.statusCode, keys.body).toBe(200);
    expect(keys.json().keys[0]).toMatchObject({ alg: "EdDSA", crv: "Ed25519" });
    expect(keys.json().keys[0].d).toBeUndefined();
  });

  it("exchanges a PKCE code once and verifies scoped ID token and UserInfo claims", async () => {
    const { res, verifier } = await authorize();
    expect(res.statusCode, res.body).toBe(302);
    const callback = new URL(String(res.headers.location));
    expect(callback.origin).toBe("https://prismtone.lumorphia.test");
    expect(callback.searchParams.get("state")).toBe("test-state");
    const code = callback.searchParams.get("code")!;
    const exchanged = await token(code, verifier);
    expect(exchanged.statusCode, exchanged.body).toBe(200);
    const body = exchanged.json();
    const keys = (await app.inject({ method: "GET", url: "/api/auth/jwks", headers })).json();
    const { payload } = await jwtVerify(body.id_token, createLocalJWKSet(keys), {
      issuer: `${origin}/api/auth`,
      audience: client.client_id,
      algorithms: ["EdDSA"],
    });
    expect(payload.sub).toBe(userId);
    expect(payload.nonce).toBe("test-nonce");
    expect(payload["https://lumorphia.com/handle"]).toBe(`oidc_${stamp}`);
    expect(payload["https://lumorphia.com/identities"]).toEqual([
      { provider: "discord", id: `test-discord-${stamp}` },
    ]);
    const info = await app.inject({
      method: "GET",
      url: "/api/auth/oauth2/userinfo",
      headers: { ...headers, authorization: `Bearer ${body.access_token}` },
    });
    expect(info.statusCode, info.body).toBe(200);
    expect(info.json()["https://lumorphia.com/handle"]).toBe(`oidc_${stamp}`);
    expect((await token(code, verifier)).statusCode).toBe(400);
  });

  it("rejects identity scope for a client without migration access", async () => {
    const { res } = await authorize(
      "openid lumorphia:identities",
      scenote.client_id,
      "https://scenote.lumorphia.test/api/auth/callback/lumorphia",
    );
    expect(res.statusCode).toBe(302);
    expect(new URL(String(res.headers.location)).searchParams.get("error")).toBe("invalid_scope");
  });

  it("omits identities without their scope and refuses non active claim issuance", async () => {
    const claims = await lumorphiaClaims(app.db, userId, ["openid", "profile"]);
    expect(claims["https://lumorphia.com/identities"]).toBeUndefined();
    await app.db
      .update(schema.users)
      .set({ status: "suspended" })
      .where(eq(schema.users.id, userId));
    try {
      await expect(lumorphiaClaims(app.db, userId, ["openid"])).rejects.toThrow(
        "active account required",
      );
    } finally {
      await app.db
        .update(schema.users)
        .set({ status: "active" })
        .where(eq(schema.users.id, userId));
    }
  });

  it("requires client authentication at protocol endpoints without Origin", async () => {
    for (const path of ["token", "introspect", "revoke"]) {
      const res = await app.inject({
        method: "POST",
        url: `/api/auth/oauth2/${path}`,
        headers: {
          host: headers.host,
          "x-forwarded-proto": "https",
          "content-type": "application/x-www-form-urlencoded",
        },
        payload: "token=test-invalid",
      });
      expect(res.statusCode).not.toBe(403);
      expect(res.statusCode).toBeGreaterThanOrEqual(400);
      expect(res.statusCode).toBeLessThan(500);
    }
  });

  it("refuses client registration by a non administrator", async () => {
    await app.db.update(schema.users).set({ role: "user" }).where(eq(schema.users.id, userId));
    try {
      await expect(
        registerServiceClient(app.auth, new Headers({ cookie }), {
          service: "scenote",
          redirectUri,
        }),
      ).rejects.toThrow("administrator");
    } finally {
      await app.db.update(schema.users).set({ role: "admin" }).where(eq(schema.users.id, userId));
    }
  });
});
