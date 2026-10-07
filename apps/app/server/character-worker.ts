import { pathToFileURL } from "node:url";
import { createDatabase } from "@lumorphia-accounts/db";
import { HttpLodestoneSource } from "@lumorphia-accounts/core/adapters/lodestone";
import { startCharacterWorker } from "@lumorphia-accounts/core/jobs";
import { createLogger } from "@lumorphia/ops/logger";
import { handleShutdownSignals } from "./graceful-shutdown.ts";
import { loadCharacterWorkerEnv } from "./character-worker-env.ts";

export async function createCharacterWorker(source: NodeJS.ProcessEnv = process.env) {
  const env = loadCharacterWorkerEnv(source);
  const log = createLogger("character-worker", { level: env.LOG_LEVEL });
  const { db, close } = createDatabase(env.DATABASE_URL, {
    onIdleError: (err) => log.error({ err }, "worker database error"),
  });
  try {
    const worker = await startCharacterWorker({
      connectionString: env.DATABASE_URL,
      db,
      log,
      enabled: env.FEATURE_LODESTONE,
      lodestone: new HttpLodestoneSource({
        baseUrl: env.LODESTONE_BASE_URL,
        userAgent: env.LODESTONE_USER_AGENT ?? "lumorphia-accounts/dev",
      }),
    });
    log.info({ enabled: env.FEATURE_LODESTONE }, "character worker started");
    return {
      log,
      async close() {
        try {
          await worker.stop();
        } finally {
          await close();
        }
      },
    };
  } catch (error) {
    await close();
    throw error;
  }
}

const entryPoint = process.argv[1] ? pathToFileURL(process.argv[1]).href : undefined;
if (import.meta.url === entryPoint) {
  const worker = await createCharacterWorker();
  handleShutdownSignals(worker, 30_000);
}
