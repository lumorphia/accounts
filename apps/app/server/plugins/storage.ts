import fp from "fastify-plugin";
import { createStorage, storageConfigFromEnv, type ObjectStorage } from "@lumorphia/storage";

declare module "fastify" {
  interface FastifyInstance {
    storage: ObjectStorage;
  }
}

/** 開発と E2E はメモリ、本番は設定済みの S3 互換ストレージを使う。 */
export const storagePlugin = fp<{ storage?: ObjectStorage }>(
  async (app, opts) => {
    const storage =
      opts.storage ??
      createStorage(
        storageConfigFromEnv({
          ...process.env,
          STORAGE_DRIVER:
            process.env.STORAGE_DRIVER ?? (app.env.NODE_ENV === "production" ? "s3" : "memory"),
        }),
      );
    app.decorate("storage", storage);
  },
  { name: "storage" },
);
