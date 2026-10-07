import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { eq, schema } from "@lumorphia-accounts/db";
import { buildApp } from "../app.ts";
import { loadEnv } from "../env.ts";
import { isPublicAuthPath } from "./public-endpoints.ts";

const url = process.env.DATABASE_URL;
const origin = "https://accounts.lumorphia.test:3443";
const headers = { host: new URL(origin).host, origin, "x-forwarded-proto": "https" };
const cookieOf = (raw: unknown) =>
  (Array.isArray(raw) ? raw : [String(raw)]).map((s) => String(s).split(";")[0]).join("; ");

describe.skipIf(!url)("Better Auth HTTP surface (PostgreSQL)", () => {
  let app: FastifyInstance;
  let cookie: string;
  let userId: string;
  beforeAll(async () => {
    app = await buildApp({
      env: loadEnv({
        NODE_ENV: "test",
        DATABASE_URL: url,
        AUTH_BASE_URL: origin,
        LOG_LEVEL: "silent",
      }),
    });
    await app.ready();
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/dev/login",
      headers,
      payload: { handle: `pe_${randomBytes(5).toString("hex")}` },
    });
    cookie = cookieOf(res.headers["set-cookie"]);
    userId = res.json().userId;
  });
  afterAll(async () => {
    await app?.close();
  });

  it("does not let a signed in user rewrite the profile through update-user", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/update-user",
      headers: { ...headers, cookie },
      payload: { name: "x".repeat(300), image: "https://example.invalid/test.png" },
    });
    expect(res.statusCode).toBe(404);
    const user = await app.db.query.users.findFirst({ where: eq(schema.users.id, userId) });
    expect(user?.name.length).toBeLessThanOrEqual(50);
    expect(user?.image).not.toBe("https://example.invalid/test.png");
  });

  it("answers 404 for every Better Auth endpoint outside the allowlist", async () => {
    const endpoints = Object.values(app.auth.api as Record<string, unknown>).flatMap((value) => {
      const endpoint = value as {
        path?: string;
        options?: { method?: string | string[]; metadata?: { SERVER_ONLY?: boolean } };
      };
      if (!endpoint?.path || endpoint.options?.metadata?.SERVER_ONLY) return [];
      const method = [endpoint.options?.method ?? "GET"].flat()[0]!;
      const path = `/api/auth${endpoint.path.replace(/:[^/]+/g, "test")}`;
      return isPublicAuthPath(path) ? [] : [{ method, path }];
    });
    expect(endpoints.length).toBeGreaterThan(20);
    for (const { method, path } of endpoints) {
      const res = await app.inject({
        method: method as "GET" | "POST",
        url: path,
        headers: { ...headers, cookie },
        ...(method === "GET" ? {} : { payload: {} }),
      });
      expect(res.statusCode, `${method} ${path}`).toBe(404);
    }
  });

  it("keeps the allowlisted endpoints reachable", async () => {
    const res = await app.inject({ method: "GET", url: "/api/auth/jwks", headers });
    expect(res.statusCode, res.body).toBe(200);
  });
});
