import { readFileSync } from "node:fs";
import { createServer, request as httpsRequest } from "node:https";
import { createLocalJWKSet, jwtVerify, type JWTPayload } from "jose";
import { createDatabase, eq, schema } from "@lumorphia-accounts/db";
import { e2eDatabaseUrl } from "./database.ts";
import { buildApp } from "../apps/app/server/app.ts";
import { loadEnv } from "../apps/app/server/env.ts";
import { deliverAccountEvents } from "../packages/core/src/jobs/account-lifecycle.ts";
import { expect, test } from "./test.ts";
import { gotoHydrated } from "./helpers.ts";

test("deletes the global account and recovers its identity on a new login over HTTPS", async ({
  page,
}) => {
  const handle = `dl_${Date.now().toString(36)}`;
  await gotoHydrated(page, "/login");
  await page.getByLabel("開発用ログイン").fill(handle);
  await page.getByTestId("dev-login").getByRole("button", { name: "ログイン" }).click();
  await page.waitForURL("/");
  const before = await page.evaluate(async () => (await (await fetch("/api/me")).json()).user.id);
  await gotoHydrated(page, "/settings");
  await page.getByRole("button", { name: "Lumorphia から退会", exact: true }).click();
  await expect(page.getByTestId("global-deletion-confirmation")).toContainText(
    "画像は復旧しても戻りません",
  );
  await page.getByLabel("退会の確認用 ID", { exact: true }).fill(handle);
  await page.getByRole("button", { name: "退会を確定", exact: true }).click();
  await page.waitForURL("**/login?deleted=1");
  const after = await page.evaluate(async () => (await (await fetch("/api/me")).json()).user);
  expect(after).toBeNull();
  await page.getByLabel("開発用ログイン").fill(handle);
  await page.getByTestId("dev-login").getByRole("button", { name: "ログイン" }).click();
  await page.waitForURL("/");
  const restored = await page.evaluate(async () => (await (await fetch("/api/me")).json()).user);
  expect(restored.id).toBe(before);
  expect(restored.status).toBe("active");
});

test("deletes and restores one service while keeping the Lumorphia account active", async ({
  page,
}) => {
  const handle = `sv_${Date.now().toString(36)}`;
  await gotoHydrated(page, "/login");
  await page.getByLabel("開発用ログイン").fill(handle);
  await page.getByTestId("dev-login").getByRole("button", { name: "ログイン" }).click();
  await page.waitForURL("/");
  const userId = await page.evaluate(async () => (await (await fetch("/api/me")).json()).user.id);
  const database = createDatabase(e2eDatabaseUrl());
  try {
    await database.db.insert(schema.serviceMemberships).values({ userId, service: "scenote" });
    await gotoHydrated(page, "/settings");
    const service = page.getByTestId("service-membership").filter({ hasText: "Scenote" });
    await service.getByRole("button", { name: "このサービスを退会" }).click();
    await page.getByLabel("退会の確認用 ID", { exact: true }).fill(handle);
    await page.getByRole("button", { name: "退会を確定", exact: true }).click();
    await expect(service).toContainText("退会済み");
    expect(
      await page.evaluate(async () => (await (await fetch("/api/me")).json()).user.status),
    ).toBe("active");
    await service.getByRole("button", { name: "このサービスを復旧" }).click();
    await expect(service.getByRole("button", { name: "このサービスを退会" })).toBeVisible();
  } finally {
    await database.close();
  }
});

test("retries signed deletion delivery over verified TLS before sending restoration", async ({
  page,
}) => {
  const port = Number(process.env.MOCK_ACCOUNT_EVENTS_PORT ?? 3405);
  const endpoint = `https://scenote.lumorphia.test:${port}/api/lumorphia/account-events`;
  const ca = readFileSync(new URL("../.data/tls/ca.pem", import.meta.url));
  const origin = `https://accounts.lumorphia.test:${process.env.E2E_PORT ?? 3443}`;
  const app = await buildApp({
    env: loadEnv({
      NODE_ENV: "test",
      DATABASE_URL: e2eDatabaseUrl(),
      AUTH_BASE_URL: origin,
      AUTH_SECRET: "test-e2e-secret-test-e2e-secret-1234",
      LOG_LEVEL: "silent",
      FEATURE_ACCOUNT_LIFECYCLE: "1",
    }),
  });
  await app.ready();
  const clientId = `test-events-${crypto.randomUUID()}`;
  await app.db.insert(schema.oauthClients).values({
    clientId,
    name: "scenote",
    redirectUris: [`https://scenote.lumorphia.test:${port}/callback`],
    metadata: { lifecycle_uri: endpoint },
  });
  const keys = createLocalJWKSet(
    (await app.inject({ method: "GET", url: "/api/auth/jwks" })).json(),
  );
  let failFirst = true;
  let received: JWTPayload[] = [];
  const server = createServer(
    {
      cert: readFileSync(new URL("../.data/tls/cert.pem", import.meta.url)),
      key: readFileSync(new URL("../.data/tls/key.pem", import.meta.url)),
    },
    (req, res) => {
      let body = "";
      req.on("data", (chunk) => {
        body += String(chunk);
      });
      req.on("end", () => {
        void (async () => {
          const token = new URLSearchParams(body).get("event_token")!;
          const { payload } = await jwtVerify(token, keys, {
            issuer: `${origin}/api/auth`,
            audience: clientId,
            typ: "lumorphia-account-event+jwt",
            algorithms: ["EdDSA"],
          });
          if (failFirst) {
            failFirst = false;
            res.writeHead(503);
            res.end();
            return;
          }
          received = [...received, payload];
          res.writeHead(204);
          res.end();
        })().catch(() => {
          res.writeHead(400);
          res.end();
        });
      });
    },
  );
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  const fetchFn: typeof fetch = async (input, init) => {
    if (String(input) !== endpoint) return new Response(null, { status: 503 });
    return new Promise<Response>((resolve, reject) => {
      const req = httpsRequest(
        endpoint,
        {
          method: "POST",
          headers: init?.headers as Record<string, string>,
          ca,
          signal: init?.signal ?? undefined,
          lookup: (_hostname, options, callback) => {
            if (options.all) callback(null, [{ address: "127.0.0.1", family: 4 }]);
            else callback(null, "127.0.0.1", 4);
          },
        },
        (res) => {
          res.resume();
          res.on("end", () => resolve(new Response(null, { status: res.statusCode! })));
        },
      );
      req.on("error", reject);
      req.end(String(init?.body));
    });
  };
  let userId: string | undefined;
  try {
    const handle = `nt_${Date.now().toString(36)}`;
    await gotoHydrated(page, "/login");
    await page.getByLabel("開発用ログイン").fill(handle);
    await page.getByTestId("dev-login").getByRole("button", { name: "ログイン" }).click();
    await page.waitForURL("/");
    userId = await page.evaluate(async () => (await (await fetch("/api/me")).json()).user.id);
    await app.db.insert(schema.serviceMemberships).values({ userId: userId!, service: "scenote" });
    await gotoHydrated(page, "/settings");
    await page.getByRole("button", { name: "Lumorphia から退会", exact: true }).click();
    await page.getByLabel("退会の確認用 ID", { exact: true }).fill(handle);
    await page.getByRole("button", { name: "退会を確定", exact: true }).click();
    await page.waitForURL("**/login?deleted=1");
    await page.getByLabel("開発用ログイン").fill(handle);
    await page.getByTestId("dev-login").getByRole("button", { name: "ログイン" }).click();
    await page.waitForURL("/");
    const sign = async (row: typeof schema.accountEvents.$inferSelect) =>
      (
        await app.auth.api.signAccountEvent({
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
              deletedAt: row.deletedAt?.toISOString() ?? null,
              recoverUntil: row.recoverUntil?.toISOString() ?? null,
            },
          },
        })
      ).token;
    await deliverAccountEvents({ db: app.db, sign, fetch: fetchFn });
    expect(received).toHaveLength(0);
    await deliverAccountEvents({
      db: app.db,
      sign,
      fetch: fetchFn,
      now: () => new Date(Date.now() + 61_000),
    });
    expect(received.map((event) => (event.lifecycle as { state: string }).state)).toEqual([
      "deleted",
      "active",
    ]);
    expect(received.map((event) => (event.lifecycle as { revision: number }).revision)).toEqual([
      1, 2,
    ]);
  } finally {
    if (userId)
      await app.db.delete(schema.accountEvents).where(eq(schema.accountEvents.sub, userId));
    await app.db.delete(schema.oauthClients).where(eq(schema.oauthClients.clientId, clientId));
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await app.close();
  }
});
