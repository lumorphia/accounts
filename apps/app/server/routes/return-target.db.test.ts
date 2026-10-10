import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { eq, schema } from "@lumorphia-accounts/db";
import { buildApp } from "../app.ts";
import { loadEnv } from "../env.ts";
import { registerServiceClient } from "../auth/oidc-clients.ts";

const url = process.env.DATABASE_URL;
const origin = "https://accounts.lumorphia.test:3443";
const headers = { host: new URL(origin).host, origin, "x-forwarded-proto": "https" };
const cookies = (raw: unknown) =>
  (Array.isArray(raw) ? raw : [String(raw)]).map((v) => String(v).split(";")[0]).join("; ");

// 設定画面からサービスへ戻るリンク (prismtone ADR-0052)。登録したサービスの URL にだけ戻す
describe.skipIf(!url)("return target (PostgreSQL)", () => {
  let app: FastifyInstance, cookie: string;
  const stamp = randomUUID().slice(0, 8);
  const prismtone = "https://prismtone.lumorphia.test:8444";
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
    const login = await app.inject({
      method: "POST",
      url: "/api/auth/dev/login",
      headers,
      payload: { handle: `rt_${stamp}` },
    });
    cookie = cookies(login.headers["set-cookie"]);
    const userId = login.json().userId;
    await app.db.update(schema.users).set({ role: "admin" }).where(eq(schema.users.id, userId));
    await registerServiceClient(app.auth, new Headers({ cookie }), {
      service: "prismtone",
      redirectUri: `${prismtone}/api/auth/callback/lumorphia`,
    });
  });
  afterAll(async () => {
    await app?.close();
  });

  const ask = (target: string, withCookie = true) =>
    app.inject({
      method: "GET",
      url: `/api/return-target?url=${encodeURIComponent(target)}`,
      headers: { ...headers, ...(withCookie ? { cookie } : {}) },
    });

  it("returns the service for a page on a registered service", async () => {
    const res = await ask(`${prismtone}/settings?lumorphia=updated`);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toEqual({
      target: { service: "prismtone", url: `${prismtone}/settings?lumorphia=updated` },
    });
  });

  it.each([
    ["another host", "https://evil.example/settings"],
    ["another port", "https://prismtone.lumorphia.test:9999/settings"],
    ["plain http", "http://prismtone.lumorphia.test:8444/settings"],
    ["a script URL", "javascript:alert(1)"],
    ["credentials in the URL", "https://user:pass@prismtone.lumorphia.test:8444/settings"],
    ["not a URL", "settings"],
  ])("returns no target for %s", async (_label, target) => {
    const res = await ask(target);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toEqual({ target: null });
  });

  it("returns no target for a disabled client", async () => {
    const scenote = "https://scenote.lumorphia.test:8445";
    const client = (await registerServiceClient(app.auth, new Headers({ cookie }), {
      service: "scenote",
      redirectUri: `${scenote}/api/auth/callback/lumorphia`,
    })) as { client_id: string };
    await app.db
      .update(schema.oauthClients)
      .set({ disabled: true })
      .where(eq(schema.oauthClients.clientId, client.client_id));
    expect((await ask(`${scenote}/settings`)).json()).toEqual({ target: null });
  });

  it("requires a session", async () => {
    expect((await ask(`${prismtone}/settings`, false)).statusCode).toBe(401);
  });
});
