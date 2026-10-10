import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "./app.ts";
import { loadEnv } from "./env.ts";

const url = process.env.DATABASE_URL;
const key = "avatars/00000000-0000-4000-8000-000000000001/0123456789abcdef/64.webp";

// 開発ではアイコンを /api/media から配る。本番は R2 の公開ドメイン
describe.skipIf(!url)("development avatar media", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp({ env: loadEnv({ NODE_ENV: "test", DATABASE_URL: url }) });
    await app.storage.put({ key, body: new Uint8Array([1, 2, 3]), contentType: "image/webp" });
  });

  afterAll(async () => {
    await app?.close();
  });

  it("serves an avatar", async () => {
    const res = await app.inject({ method: "GET", url: `/api/media/${key}` });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("image/webp");
  });

  // Prismtone などのサービスの画面から <img> で読めるようにする (本番の R2 と同じ)
  it("lets other origins load the avatar", async () => {
    const res = await app.inject({ method: "GET", url: `/api/media/${key}` });
    expect(res.headers["cross-origin-resource-policy"]).toBe("cross-origin");
  });
});
