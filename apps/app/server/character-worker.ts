import { pathToFileURL } from "node:url";
import { createDatabase } from "@lumorphia-accounts/db";
import {
  HttpLodestoneSource,
  PostgresLodestonePacer,
} from "@lumorphia-accounts/core/adapters/lodestone";
import { startCharacterWorker } from "@lumorphia-accounts/core/jobs";
import { createLogger } from "@lumorphia/ops/logger";
import { startWorkerHeartbeat } from "./worker-health.ts";
import { handleShutdownSignals } from "./graceful-shutdown.ts";
import { loadCharacterWorkerEnv } from "./character-worker-env.ts";

export async function createCharacterWorker(source: NodeJS.ProcessEnv = process.env) {
  const env = loadCharacterWorkerEnv(source);
  const log = createLogger("character-worker", { level: env.LOG_LEVEL });
  const { db, close } = createDatabase(env.DATABASE_URL, {
    onIdleError: (err) => log.error({ err }, "worker database error"),
  });
  const pacing = createDatabase(env.DATABASE_URL, {
    maxConnections: 1,
    onIdleError: (err) => log.error({ err }, "lodestone pacing database error"),
  });
  let worker: Awaited<ReturnType<typeof startCharacterWorker>> | undefined;
  let stopHeartbeat: (() => Promise<void>) | undefined;
  try {
    worker = await startCharacterWorker({
      connectionString: env.DATABASE_URL,
      db,
      log,
      enabled: env.FEATURE_LODESTONE,
      lodestone: new HttpLodestoneSource({
        baseUrl: env.LODESTONE_BASE_URL,
        pacer: new PostgresLodestonePacer(pacing.db),
        userAgent: env.LODESTONE_USER_AGENT ?? "lumorphia-accounts/dev",
      }),
    });
    stopHeartbeat = await startWorkerHeartbeat(db, "characters", env.FEATURE_LODESTONE, () =>
      log.error("worker heartbeat failed"),
    );
    log.info({ enabled: env.FEATURE_LODESTONE }, "character worker started");
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
          await pacing.close();
          await close();
        }
      },
    };
  } catch (error) {
    await worker?.stop().catch(() => log.error("worker startup cleanup failed"));
    await stopHeartbeat?.().catch(() => log.error("worker heartbeat cleanup failed"));
    await pacing.close();
    await close();
    throw error;
  }
}

const entryPoint = process.argv[1] ? pathToFileURL(process.argv[1]).href : undefined;
if (import.meta.url === entryPoint) {
  const worker = await createCharacterWorker();
  handleShutdownSignals(worker, 30_000);
}
