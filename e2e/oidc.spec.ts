import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer } from "node:https";
import type { Page } from "@playwright/test";
import { createLocalJWKSet, decodeJwt, jwtVerify } from "jose";
import { eq, schema } from "@lumorphia-accounts/db";
import { buildApp } from "../apps/app/server/app.ts";
import { loadEnv } from "../apps/app/server/env.ts";
import { registerServiceClient } from "../apps/app/server/auth/oidc-clients.ts";
import { e2eDatabaseUrl } from "./database.ts";
import { expect, test } from "./test.ts";
import { gotoHydrated, waitForHydration } from "./helpers.ts";

const origin = `https://accounts.lumorphia.test:${process.env.E2E_PORT ?? 3443}`;
const callbackPort = Number(process.env.MOCK_OIDC_PORT ?? 3403);
const redirectUri = `https://prismtone.lumorphia.test:${callbackPort}/api/auth/callback/lumorphia`;
const headers = { host: new URL(origin).host, origin, "x-forwarded-proto": "https" };
const socials = {
  discord: { label: "Discord", authorize: "https://discord.com/api/oauth2/authorize**" },
  google: { label: "Google", authorize: "https://accounts.google.com/o/oauth2/v2/auth**" },
  twitter: { label: "X", authorize: "https://x.com/i/oauth2/authorize**" },
} as const;

// mock の利用者はサーバーごとに一人なので、このファイルでは順に回す。
test.describe("OIDC browser authorization", () => {
  test.describe.configure({ mode: "serial" });
  let app: Awaited<ReturnType<typeof buildApp>>;
  let client: { client_id: string; client_secret: string };
  let receivedLogoutTokens: string[] = [];
  // HTTP の redirect chain も実際のブラウザでたどるため、TLS のサービス側 callback を立てる。
  const callbackServer = createServer(
    {
      cert: readFileSync(new URL("../.data/tls/cert.pem", import.meta.url)),
      key: readFileSync(new URL("../.data/tls/key.pem", import.meta.url)),
    },
    (req, res) => {
      if (req.method === "POST" && req.url === "/api/lumorphia/backchannel-logout") {
        let body = "";
        req.on("data", (chunk) => {
          body += chunk;
        });
        req.on("end", () => {
          const token = new URLSearchParams(body).get("logout_token");
          if (token) receivedLogoutTokens = [...receivedLogoutTokens, token];
          res.writeHead(204);
          res.end();
        });
        return;
      }
      res.writeHead(200, { "content-type": "text/html" });
      res.end("<p>Service callback</p>");
    },
  );

  test.beforeAll(async () => {
    await new Promise<void>((resolve, reject) => {
      callbackServer.once("error", reject);
      callbackServer.listen(callbackPort, "127.0.0.1", resolve);
    });
    app = await buildApp({
      env: loadEnv({
        NODE_ENV: "test",
        DATABASE_URL: e2eDatabaseUrl(),
        AUTH_BASE_URL: origin,
        AUTH_SECRET: "test-e2e-secret-test-e2e-secret-1234",
        LOG_LEVEL: "silent",
      }),
    });
    await app.ready();
    const login = await app.inject({
      method: "POST",
      url: "/api/auth/dev/login",
      headers,
      payload: { handle: `oa_${randomBytes(5).toString("hex")}` },
    });
    expect(login.statusCode).toBe(200);
    const raw = login.headers["set-cookie"];
    const cookie = (Array.isArray(raw) ? raw : [String(raw)])
      .map((v) => v.split(";")[0])
      .join("; ");
    await app.db
      .update(schema.users)
      .set({ role: "admin" })
      .where(eq(schema.users.id, login.json().userId));
    client = (await registerServiceClient(app.auth, new Headers({ cookie }), {
      service: "prismtone",
      redirectUri,
      postLogoutRedirectUri: `https://prismtone.lumorphia.test:${callbackPort}/signed-out`,
      backchannelLogoutUri: "https://prismtone.lumorphia.com/api/lumorphia/backchannel-logout",
    })) as typeof client;
  });
  test.afterAll(async () => {
    await app?.close();
    await new Promise<void>((resolve, reject) =>
      callbackServer.close((error) => (error ? reject(error) : resolve())),
    );
  });

  async function authorizeSession(page: Page, scope = "openid profile") {
    receivedLogoutTokens = [];
    await gotoHydrated(page, "/login?next=%2Fsettings");
    await page.getByLabel("開発用ログイン").fill(`lo_${randomBytes(6).toString("hex")}`);
    await page.getByTestId("dev-login").getByRole("button", { name: "ログイン" }).click();
    await page.waitForURL("**/settings");
    const verifier = randomBytes(32).toString("base64url");
    const query = new URLSearchParams({
      client_id: client.client_id,
      redirect_uri: redirectUri,
      response_type: "code",
      scope,
      state: "test-logout-auth",
      nonce: "test-logout-nonce",
      code_challenge: createHash("sha256").update(verifier).digest("base64url"),
      code_challenge_method: "S256",
    });
    await page.goto(`/api/auth/oauth2/authorize?${query}`);
    await page.waitForURL((url) => url.origin === new URL(redirectUri).origin);
    const code = new URL(page.url()).searchParams.get("code")!;
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
        code,
        code_verifier: verifier,
      }).toString(),
    });
    expect(exchanged.statusCode).toBe(200);
    return {
      query,
      idToken: exchanged.json().id_token as string,
      accessToken: exchanged.json().access_token as string,
    };
  }

  for (const provider of [
    "discord",
    "google",
    "twitter",
    "misskey",
    "mastodon",
    "dev",
    "sso",
  ] as const) {
    test(`${provider} returns a verified ID token after browser authorization`, async ({
      page,
    }) => {
      const handle = `o_${randomBytes(6).toString("hex")}`;
      if (provider === "sso") {
        await gotoHydrated(page, "/login?next=%2Fsettings");
        await page.getByLabel("開発用ログイン").fill(handle);
        await page.getByTestId("dev-login").getByRole("button", { name: "ログイン" }).click();
        await page.waitForURL("**/settings");
      }
      const verifier = randomBytes(32).toString("base64url");
      const nonce = `test-${randomBytes(8).toString("hex")}`;
      const state = `test-${randomBytes(8).toString("hex")}`;
      const query = new URLSearchParams({
        client_id: client.client_id,
        redirect_uri: redirectUri,
        response_type: "code",
        scope: "openid profile email lumorphia:identities",
        state,
        nonce,
        code_challenge: createHash("sha256").update(verifier).digest("base64url"),
        code_challenge_method: "S256",
      });
      if (provider in socials) {
        const social = provider as keyof typeof socials;
        await page.request.post(
          `http://127.0.0.1:${process.env.MOCK_OAUTH_PORT ?? 3401}/_e2e/${provider}`,
          {
            data: {
              id: String(BigInt(`0x${randomBytes(7).toString("hex")}`)),
              name: `OIDC ${provider}`,
            },
          },
        );
        await page.route(socials[social].authorize, async (route) => {
          const url = new URL(route.request().url());
          const callback = new URL(url.searchParams.get("redirect_uri")!);
          callback.searchParams.set("code", `mock-code-${provider}`);
          callback.searchParams.set("state", url.searchParams.get("state")!);
          await route.fulfill({ status: 302, headers: { location: callback.href } });
        });
      } else if (provider === "misskey" || provider === "mastodon") {
        const port =
          provider === "misskey"
            ? (process.env.MOCK_MISSKEY_PORT ?? 3399)
            : (process.env.MOCK_MASTODON_PORT ?? 3402);
        await page.request.post(`http://127.0.0.1:${port}/_e2e/user`, {
          data: { id: `test-${randomBytes(8).toString("hex")}`, username: `oidc_${provider}` },
        });
      }
      await page.goto(`/api/auth/oauth2/authorize?${query}`);
      if (provider !== "sso") {
        await page.waitForURL((url) => url.pathname === "/login");
        await waitForHydration(page);
        if (provider === "dev") {
          await page.getByLabel("開発用ログイン").fill(handle);
          await page.getByTestId("dev-login").getByRole("button", { name: "ログイン" }).click();
        } else if (provider === "misskey" || provider === "mastodon") {
          const port =
            provider === "misskey"
              ? (process.env.MOCK_MISSKEY_PORT ?? 3399)
              : (process.env.MOCK_MASTODON_PORT ?? 3402);
          await page.locator("summary").filter({ hasText: "Misskey・Mastodon" }).click();
          await page
            .getByLabel(`${provider === "misskey" ? "Misskey" : "Mastodon"} のサーバー`)
            .fill(`127.0.0.1:${port}`);
          await page.getByTestId(`${provider}-submit`).click();
        } else {
          await page.getByRole("button", { name: `${socials[provider].label} でログイン` }).click();
        }
        if (provider !== "dev") {
          await page.waitForURL((url) => url.pathname === "/welcome");
          await waitForHydration(page);
          await page.getByTestId("welcome-handle").fill(handle);
          await page.getByLabel("15歳以上です").check();
          await page.getByLabel("利用規約とプライバシーポリシーを読み、同意します").check();
          await page.getByRole("button", { name: "設定を完了" }).click();
        }
      }
      await page.waitForURL((url) => url.origin === new URL(redirectUri).origin);
      const callback = new URL(page.url());
      expect(callback.searchParams.get("state")).toBe(state);
      expect(callback.searchParams.has("error")).toBe(false);
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
      const keys = (await app.inject({ method: "GET", url: "/api/auth/jwks", headers })).json();
      const { payload } = await jwtVerify(exchanged.json().id_token, createLocalJWKSet(keys), {
        issuer: `${origin}/api/auth`,
        audience: client.client_id,
        algorithms: ["EdDSA"],
      });
      expect(payload.nonce).toBe(nonce);
      expect(payload["https://lumorphia.com/handle"]).toBe(handle);
      expect(payload["https://lumorphia.com/legacy_pending"]).toEqual([]);
      const info = await app.inject({
        method: "GET",
        url: "/api/auth/oauth2/userinfo",
        headers: { ...headers, authorization: `Bearer ${exchanged.json().access_token}` },
      });
      expect(info.statusCode).toBe(200);
      expect(info.json()["https://lumorphia.com/handle"]).toBe(handle);
    });
  }
  test("a scoped service token reads its owner's verified characters over HTTPS", async ({
    page,
  }) => {
    const tokens = await authorizeSession(page, "openid profile lumorphia:characters");
    const userId = decodeJwt(tokens.idToken).sub!;
    // 合成データ。Lodestone の fixture やほかのプレイヤーを参照しない。
    const [character] = await app.db
      .insert(schema.characters)
      .values({
        userId,
        lodestoneId: String(10_000_000_000n + BigInt(`0x${randomBytes(4).toString("hex")}`)),
        name: "Test Character",
        world: "Tiamat",
        dataCenter: "Gaia",
        verifiedAt: new Date(),
        isPrimary: true,
      })
      .returning();
    try {
      await gotoHydrated(page, "/settings");
      const result = await page.evaluate(async (token) => {
        const response = await fetch("/api/characters", {
          headers: { authorization: `Bearer ${token}` },
        });
        return {
          status: response.status,
          cache: response.headers.get("cache-control"),
          body: await response.json(),
        };
      }, tokens.accessToken);
      expect(result.status).toBe(200);
      expect(result.cache).toBe("no-store");
      expect(result.body.characters).toHaveLength(1);
      expect(result.body.characters[0]).toMatchObject({ id: character!.id, verified: true });
      expect(result.body.characters[0].verification).toBeUndefined();
    } finally {
      await app.db.delete(schema.characters).where(eq(schema.characters.id, character!.id));
    }
  });

  test("RP initiated logout clears the browser session and delivers a signed token over TLS", async ({
    page,
  }) => {
    const { query, idToken } = await authorizeSession(page);
    const logout = new URLSearchParams({
      id_token_hint: idToken,
      post_logout_redirect_uri: `https://prismtone.lumorphia.test:${callbackPort}/signed-out`,
      state: "test-browser-logout",
    });
    await page.goto(`/api/auth/oauth2/end-session?${logout}`);
    await page.waitForURL((url) => url.pathname === "/signed-out");
    expect(new URL(page.url()).searchParams.get("state")).toBe("test-browser-logout");
    expect(receivedLogoutTokens.length).toBe(1);
    const keys = (await app.inject({ method: "GET", url: "/api/auth/jwks", headers })).json();
    const { payload } = await jwtVerify(receivedLogoutTokens[0]!, createLocalJWKSet(keys), {
      issuer: `${origin}/api/auth`,
      audience: client.client_id,
      algorithms: ["EdDSA"],
      typ: "logout+jwt",
    });
    const hinted = decodeJwt(idToken);
    expect(payload.sub).toBe(hinted.sub);
    expect(payload.sid).toBe(hinted.sid);
    expect(payload.events).toEqual({ "http://schemas.openid.net/event/backchannel-logout": {} });
    expect(payload.nonce).toBeUndefined();
    await gotoHydrated(page, "/login");
    const me = await page.evaluate(async () => (await fetch("/api/me")).json());
    expect(me.user).toBeNull();
    await page.goto(`/api/auth/oauth2/authorize?${query}`);
    await page.waitForURL((url) => url.pathname === "/login");
  });

  test("a browser confirms logout without an ID token hint and returns to the service", async ({
    page,
  }) => {
    await authorizeSession(page);
    const query = new URLSearchParams({
      client_id: client.client_id,
      post_logout_redirect_uri: `https://prismtone.lumorphia.test:${callbackPort}/signed-out`,
      state: "test-browser-confirm",
    });
    await page.goto(`/api/auth/oauth2/end-session?${query}`);
    await expect(page.locator("form[data-oidc-logout-confirmation]")).toBeVisible();
    await page.getByRole("button", { name: "Confirm logout" }).click();
    await page.waitForURL((url) => url.pathname === "/signed-out");
    expect(new URL(page.url()).searchParams.get("state")).toBe("test-browser-confirm");
    expect(receivedLogoutTokens.length).toBe(1);
    await gotoHydrated(page, "/login");
    const me = await page.evaluate(async () => (await fetch("/api/me")).json());
    expect(me.user).toBeNull();
  });
});
