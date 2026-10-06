import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createLocalJWKSet,
  decodeJwt,
  decodeProtectedHeader,
  jwtVerify,
  type JSONWebKeySet,
} from "jose";
import type { FastifyInstance } from "fastify";
import { eq, schema } from "@lumorphia-accounts/db";
import { buildApp } from "../app.ts";
import { loadEnv } from "../env.ts";
import { registerServiceClient } from "./oidc-clients.ts";

const databaseUrl = process.env.DATABASE_URL;
const origin = "https://accounts.lumorphia.test:3443";
const headers = { host: new URL(origin).host, origin, "x-forwarded-proto": "https" };
const navigation = {
  "sec-fetch-mode": "navigate",
  "sec-fetch-dest": "document",
  accept: "text/html",
};
const event = "http://schemas.openid.net/event/backchannel-logout";
const services = ["prismtone", "scenote", "facetia"] as const;
type Service = (typeof services)[number];
type Client = { client_id: string; client_secret: string };
type Delivery = {
  service: string;
  method: string | undefined;
  contentType: string | undefined;
  token: string | null;
};
const serviceOrigin = (service: Service) => `https://${service}.lumorphia.com`;
const redirectUri = (service: Service) => `${serviceOrigin(service)}/api/auth/callback/lumorphia`;
const logoutUri = (service: Service) =>
  `${serviceOrigin(service)}/api/lumorphia/backchannel-logout`;
function cookiesOf(res: { headers: Record<string, unknown> }) {
  const raw = res.headers["set-cookie"];
  return (Array.isArray(raw) ? raw : raw ? [String(raw)] : [])
    .map((value) => String(value).split(";")[0])
    .join("; ");
}

describe.skipIf(!databaseUrl)("OIDC logout (PostgreSQL)", () => {
  let app: FastifyInstance;
  let clients: Record<Service, Client>;
  let cookie: string;
  let userId: string;
  let sessionId: string;
  let deliveries: Delivery[] = [];
  let responseStatus: Partial<Record<Service, number>> = {};
  const nativeFetch = globalThis.fetch;
  const receiver = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      const service = req.url!.slice(1) as Service;
      deliveries = [
        ...deliveries,
        {
          service,
          method: req.method,
          contentType: req.headers["content-type"],
          token: new URLSearchParams(body).get("logout_token"),
        },
      ];
      res.writeHead(responseStatus[service] ?? 204);
      res.end();
    });
  });

  async function login() {
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/dev/login",
      headers,
      payload: { handle: `logout_${randomBytes(5).toString("hex")}` },
    });
    expect(res.statusCode, res.body).toBe(200);
    const cookie = cookiesOf(res);
    const session = await app.auth.api.getSession({ headers: new Headers({ cookie }) });
    expect(session).not.toBeNull();
    return { cookie, userId: session!.user.id, sessionId: session!.session.id };
  }
  beforeAll(async () => {
    await new Promise<void>((resolve, reject) => {
      receiver.once("error", reject);
      receiver.listen(0, "127.0.0.1", resolve);
    });
    const address = receiver.address();
    if (!address || typeof address === "string") throw new Error("test receiver has no port");
    // 登録時の URL 検査を変えず、既知の配送先だけを HTTP の受信サーバーに向ける。
    // 想定外の宛先にはネットワーク接続しない。
    vi.stubGlobal("fetch", (async (input, init) => {
      const url = input instanceof Request ? input.url : String(input);
      // end-session は hint の署名検証に発行元自身の JWKS を HTTP で読む。
      if (url === `${origin}/api/auth/jwks`) {
        const res = await app.inject({ method: "GET", url: "/api/auth/jwks", headers });
        return new Response(res.body, {
          status: res.statusCode,
          headers: { "content-type": "application/json" },
        });
      }
      const service = services.find((service) => logoutUri(service) === url);
      if (!service) throw new Error("unexpected outbound request in logout test");
      return nativeFetch(`http://127.0.0.1:${address.port}/${service}`, init);
    }) satisfies typeof fetch);
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
    const admin = await login();
    await app.db
      .update(schema.users)
      .set({ role: "admin" })
      .where(eq(schema.users.id, admin.userId));
    const registered = await Promise.all(
      services.map(
        async (service) =>
          [
            service,
            await registerServiceClient(app.auth, new Headers({ cookie: admin.cookie }), {
              service,
              redirectUri: redirectUri(service),
              postLogoutRedirectUri: `${serviceOrigin(service)}/`,
              backchannelLogoutUri: logoutUri(service),
            }),
          ] as const,
      ),
    );
    clients = Object.fromEntries(registered) as Record<Service, Client>;
  });
  beforeEach(async () => {
    deliveries = [];
    responseStatus = {};
    ({ cookie, userId, sessionId } = await login());
  });
  afterAll(async () => {
    vi.unstubAllGlobals();
    await app?.close();
    await new Promise<void>((resolve, reject) =>
      receiver.close((error) => (error ? reject(error) : resolve())),
    );
  });

  async function issue(service: Service = "prismtone", sessionCookie = cookie) {
    const client = clients[service];
    const verifier = randomBytes(32).toString("base64url");
    const query = new URLSearchParams({
      client_id: client.client_id,
      redirect_uri: redirectUri(service),
      response_type: "code",
      scope: "openid profile",
      state: "test-state",
      nonce: "test-nonce",
      code_challenge: createHash("sha256").update(verifier).digest("base64url"),
      code_challenge_method: "S256",
    });
    const authorized = await app.inject({
      method: "GET",
      url: `/api/auth/oauth2/authorize?${query}`,
      headers: { ...headers, ...navigation, cookie: sessionCookie },
    });
    expect(authorized.statusCode, authorized.body).toBe(302);
    const callback = new URL(String(authorized.headers.location), origin);
    expect(callback.origin).toBe(serviceOrigin(service));
    const exchanged = await protocol(
      "token",
      {
        grant_type: "authorization_code",
        redirect_uri: redirectUri(service),
        code: callback.searchParams.get("code")!,
        code_verifier: verifier,
      },
      service,
    );
    expect(exchanged.statusCode, exchanged.body).toBe(200);
    return exchanged.json() as { id_token: string; access_token: string };
  }
  function protocol(path: string, values: Record<string, string>, service: Service = "prismtone") {
    return app.inject({
      method: "POST",
      url: `/api/auth/oauth2/${path}`,
      headers: {
        host: headers.host,
        "x-forwarded-proto": "https",
        "content-type": "application/x-www-form-urlencoded",
      },
      payload: new URLSearchParams({
        client_id: clients[service].client_id,
        client_secret: clients[service].client_secret,
        ...values,
      }).toString(),
    });
  }
  function logout(idToken: string, extra: Record<string, string> = {}, sessionCookie = cookie) {
    const query = new URLSearchParams({
      id_token_hint: idToken,
      post_logout_redirect_uri: `${serviceOrigin("prismtone")}/`,
      state: "test-logout-state",
      ...extra,
    });
    return app.inject({
      method: "GET",
      url: `/api/auth/oauth2/end-session?${query}`,
      headers: { ...headers, ...navigation, cookie: sessionCookie },
    });
  }
  async function me(sessionCookie = cookie) {
    return (
      await app.inject({ method: "GET", url: "/api/me", headers: { cookie: sessionCookie } })
    ).json().user;
  }
  async function verifyDelivery(service: Service, idToken: string) {
    const received = deliveries.filter((delivery) => delivery.service === service);
    expect(received.length).toBe(1);
    const delivery = received[0]!;
    expect(delivery.method).toBe("POST");
    expect(delivery.contentType).toBe("application/x-www-form-urlencoded");
    expect(Boolean(delivery.token)).toBe(true);
    const res = await app.inject({ method: "GET", url: "/api/auth/jwks", headers });
    const { payload, protectedHeader } = await jwtVerify(
      delivery.token!,
      createLocalJWKSet(res.json<JSONWebKeySet>()),
      {
        issuer: `${origin}/api/auth`,
        audience: clients[service].client_id,
        algorithms: ["EdDSA"],
        typ: "logout+jwt",
      },
    );
    expect(protectedHeader.kid).toBe(decodeProtectedHeader(idToken).kid);
    expect(payload.sub).toBe(userId);
    expect(payload.sid).toBe(sessionId);
    expect(payload.events).toEqual({ [event]: {} });
    expect(payload.nonce).toBeUndefined();
    expect(typeof payload.jti).toBe("string");
    expect(payload.exp! - payload.iat!).toBe(120);
    return payload;
  }

  it("advertises end session and back channel logout in discovery", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/auth/.well-known/openid-configuration",
      headers,
    });
    expect(res.json()).toMatchObject({
      end_session_endpoint: `${origin}/api/auth/oauth2/end-session`,
      backchannel_logout_supported: true,
      backchannel_logout_session_supported: true,
    });
  });

  it("ends the hinted session and returns to the registered service with state", async () => {
    const issued = await issue();
    const other = await login();
    const res = await logout(issued.id_token);
    expect(res.statusCode, res.body).toBe(302);
    const returned = new URL(String(res.headers.location));
    expect(returned.origin).toBe(serviceOrigin("prismtone"));
    expect(returned.searchParams.get("state")).toBe("test-logout-state");
    expect(await me()).toBeNull();
    expect(await me(other.cookie)).not.toBeNull();
    const authorized = await app.inject({
      method: "GET",
      url: `/api/auth/oauth2/authorize?${new URLSearchParams({
        client_id: clients.prismtone.client_id,
        redirect_uri: redirectUri("prismtone"),
        response_type: "code",
        scope: "openid",
        code_challenge: createHash("sha256").update("test-verifier").digest("base64url"),
        code_challenge_method: "S256",
      })}`,
      headers: { ...headers, ...navigation, cookie },
    });
    expect(new URL(String(authorized.headers.location), origin).pathname).toBe("/login");
  });

  it("delivers a signed logout token to every service used by the ended session", async () => {
    const prismtone = await issue();
    const scenote = await issue("scenote");
    await logout(prismtone.id_token);
    expect(deliveries.map((delivery) => delivery.service).sort()).toEqual(["prismtone", "scenote"]);
    const first = await verifyDelivery("prismtone", prismtone.id_token);
    const second = await verifyDelivery("scenote", scenote.id_token);
    expect(first.jti === second.jti).toBe(false);
  });

  it("invalidates access tokens belonging to the ended session", async () => {
    const issued = await issue();
    expect((await protocol("introspect", { token: issued.access_token })).json().active).toBe(true);
    await logout(issued.id_token);
    expect((await protocol("introspect", { token: issued.access_token })).json().active).toBe(
      false,
    );
    const info = await app.inject({
      method: "GET",
      url: "/api/auth/oauth2/userinfo",
      headers: { ...headers, authorization: `Bearer ${issued.access_token}` },
    });
    expect(info.statusCode).toBe(401);
  });

  it("allows the registered service origin in the logout confirmation form policy", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/auth/oauth2/end-session?${new URLSearchParams({
        client_id: clients.prismtone.client_id,
        post_logout_redirect_uri: `${serviceOrigin("prismtone")}/`,
      })}`,
      headers: { ...headers, ...navigation, cookie },
    });
    expect(String(res.headers["content-security-policy"])).toContain(
      `form-action 'self' ${serviceOrigin("prismtone")}`,
    );
  });

  it("keeps unregistered origins out of the logout confirmation form policy", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/auth/oauth2/end-session?${new URLSearchParams({
        client_id: clients.prismtone.client_id,
        post_logout_redirect_uri: "https://unregistered.example/",
      })}`,
      headers: { ...headers, ...navigation, cookie },
    });
    const formAction = String(res.headers["content-security-policy"])
      .split(";")
      .find((directive) => directive.trim().startsWith("form-action"))
      ?.trim();
    expect(formAction).toBe("form-action 'self'");
  });

  it.each([
    ["disabled", true],
    ["enableEndSession", false],
  ] as const)("keeps the service out of the form policy when %s is %s", async (column, value) => {
    await app.db
      .update(schema.oauthClients)
      .set({ [column]: value })
      .where(eq(schema.oauthClients.clientId, clients.prismtone.client_id));
    try {
      const res = await app.inject({
        method: "GET",
        url: `/api/auth/oauth2/end-session?${new URLSearchParams({
          client_id: clients.prismtone.client_id,
          post_logout_redirect_uri: `${serviceOrigin("prismtone")}/`,
        })}`,
        headers: { ...headers, ...navigation, cookie },
      });
      const formAction = String(res.headers["content-security-policy"])
        .split(";")
        .find((directive) => directive.trim().startsWith("form-action"))
        ?.trim();
      expect(formAction).toBe("form-action 'self'");
    } finally {
      await app.db
        .update(schema.oauthClients)
        .set({ disabled: false, enableEndSession: true })
        .where(eq(schema.oauthClients.clientId, clients.prismtone.client_id));
    }
  });

  it("keeps the normal page form policy restricted to the issuer", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/me",
      headers: { ...headers, cookie },
    });
    const formAction = String(res.headers["content-security-policy"])
      .split(";")
      .find((directive) => directive.trim().startsWith("form-action"))
      ?.trim();
    expect(formAction).toBe("form-action 'self'");
  });

  it("requires browser confirmation when there is no ID token hint", async () => {
    await issue();
    const confirmation = await app.inject({
      method: "GET",
      url: `/api/auth/oauth2/end-session?${new URLSearchParams({
        client_id: clients.prismtone.client_id,
        post_logout_redirect_uri: `${serviceOrigin("prismtone")}/`,
        state: "test-confirm-state",
      })}`,
      headers: { ...headers, ...navigation, cookie },
    });
    expect(confirmation.statusCode).toBe(200);
    expect(confirmation.body).toContain("data-oidc-logout-confirmation");
    expect(await me()).not.toBeNull();
    expect(deliveries.length).toBe(0);
    const confirmed = await app.inject({
      method: "POST",
      url: "/api/auth/oauth2/end-session/confirm",
      headers: {
        ...headers,
        ...navigation,
        cookie: `${cookie}; ${cookiesOf(confirmation)}`,
        "content-type": "application/x-www-form-urlencoded",
      },
      payload: "action=confirm",
    });
    expect(confirmed.statusCode, confirmed.body).toBe(302);
    expect(new URL(String(confirmed.headers.location)).searchParams.get("state")).toBe(
      "test-confirm-state",
    );
    expect(await me()).toBeNull();
    expect(deliveries.length).toBe(1);
  });

  it("does not end either session when the hint belongs to a different browser session", async () => {
    const issued = await issue();
    const other = await login();
    const res = await logout(issued.id_token, {}, other.cookie);
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("data-oidc-logout-confirmation");
    expect(await me()).not.toBeNull();
    expect(await me(other.cookie)).not.toBeNull();
    expect(deliveries.length).toBe(0);
  });

  it("does not redirect to an unregistered post logout URL", async () => {
    const issued = await issue();
    const res = await logout(issued.id_token, {
      post_logout_redirect_uri: "https://unregistered.example/",
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers.location).toBeUndefined();
    expect(await me()).toBeNull();
  });

  it("finishes logout and delivers to other services when one receiver returns an error", async () => {
    const issued = await issue();
    const second = await issue("scenote");
    responseStatus = { prismtone: 503 };
    const res = await logout(issued.id_token);
    expect(res.statusCode).toBe(302);
    expect(await me()).toBeNull();
    await verifyDelivery("prismtone", issued.id_token);
    await verifyDelivery("scenote", second.id_token);
    // 同じ hint を再送しても、削除済みのセッションへの配送は繰り返さない。
    await logout(issued.id_token);
    expect(deliveries.length).toBe(2);
  });

  it("delivers back channel logout when the account signs out directly", async () => {
    const issued = await issue();
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/sign-out",
      headers: { ...headers, cookie },
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(await me()).toBeNull();
    await verifyDelivery("prismtone", issued.id_token);
  });

  it("rejects private back channel registration without sending any request", async () => {
    await app.db.update(schema.users).set({ role: "admin" }).where(eq(schema.users.id, userId));
    for (const backchannelLogoutUri of [
      "https://127.0.0.1/logout",
      "https://10.0.0.1/logout",
      "https://localhost/logout",
    ]) {
      await expect(
        registerServiceClient(app.auth, new Headers({ cookie }), {
          service: "prismtone",
          redirectUri: redirectUri("prismtone"),
          backchannelLogoutUri,
        }),
      ).rejects.toThrow();
    }
    expect(deliveries.length).toBe(0);
  });

  it("includes the account session in the ID token used as a logout hint", async () => {
    const issued = await issue();
    expect(decodeJwt(issued.id_token).sid).toBe(sessionId);
  });
});
