import { pathToFileURL } from "node:url";
import { createDatabase } from "@lumorphia-accounts/db";
import { createStorage, storageConfigFromEnv, type ObjectStorage } from "@lumorphia/storage";
import { startAccountWorker } from "@lumorphia-accounts/core/jobs";
import { createLogger } from "@lumorphia/ops/logger";
import { createAuth } from "./auth/auth.ts";
import { loadEnv } from "./env.ts";
import { startWorkerHeartbeat } from "./worker-health.ts";
import { handleShutdownSignals } from "./graceful-shutdown.ts";

export async function createAccountWorker(
  source: NodeJS.ProcessEnv = process.env,
  options: { storage?: ObjectStorage; fetch?: typeof fetch } = {},
) {
  const env = loadEnv(source);
  const log = createLogger("account-worker", { level: env.LOG_LEVEL });
  const database = createDatabase(env.DATABASE_URL, {
    onIdleError: (err) => log.error({ err }, "account database error"),
  });
  let worker: Awaited<ReturnType<typeof startAccountWorker>> | undefined;
  let stopHeartbeat: (() => Promise<void>) | undefined;
  try {
    const auth = createAuth({ db: database.db, env });
    const storage =
      options.storage ??
      createStorage(
        storageConfigFromEnv({
          ...source,
          STORAGE_DRIVER:
            source.STORAGE_DRIVER ?? (env.NODE_ENV === "production" ? "s3" : "memory"),
        }),
      );
    worker = await startAccountWorker({
      connectionString: env.DATABASE_URL,
      enabled: env.FEATURE_ACCOUNT_LIFECYCLE,
      log,
      deps: {
        db: database.db,
        storage,
        ...(options.fetch ? { fetch: options.fetch } : {}),
        sign: async (row) =>
          (
            await auth.api.signAccountEvent({
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
          ).token,
      },
    });
    stopHeartbeat = await startWorkerHeartbeat(
      database.db,
      "accounts",
      env.FEATURE_ACCOUNT_LIFECYCLE,
      () => log.error("worker heartbeat failed"),
    );
    log.info({ enabled: env.FEATURE_ACCOUNT_LIFECYCLE }, "account worker started");
    return {
      log,
      async close() {
        try {
          try {
            await worker?.stop();
          } finally {
            await stopHeartbeat?.();
          }
        } finally {
          await database.close();
        }
      },
    };
  } catch (error) {
    await worker?.stop().catch(() => log.error("worker startup cleanup failed"));
    await stopHeartbeat?.().catch(() => log.error("worker heartbeat cleanup failed"));
    await database.close();
    throw error;
  }
}
const entryPoint = process.argv[1] ? pathToFileURL(process.argv[1]).href : undefined;
if (import.meta.url === entryPoint) {
  const worker = await createAccountWorker();
  handleShutdownSignals(worker, 30_000);
}
