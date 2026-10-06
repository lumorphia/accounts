import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "./app.ts";
import { loadEnv } from "./env.ts";

const url = process.env.DATABASE_URL;

describe.skipIf(!url)("health with a database", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp({ env: loadEnv({ NODE_ENV: "test", DATABASE_URL: url }) });
  });

  afterAll(async () => {
    await app?.close();
  });

  it("reports ok when the database answers", async () => {
    const res = await app.inject({ method: "GET", url: "/api/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, db: "ok" });
  });
});
