import { PgBoss } from "pg-boss";
import { sql, type Database } from "@lumorphia-accounts/db";
import type { EnqueueOptions, JobName, JobQueue } from "./queue.ts";
import { CHARACTER_SYNC_CRON, runCharacterJob } from "./characters.ts";
import type { CharacterDeps } from "../domain/characters.ts";

const JOB_NAMES: readonly JobName[] = ["character-verify", "character-sync", "character-sync-all"];
export async function prepareCharacterQueues(boss: Pick<PgBoss, "createQueue">): Promise<void> {
  for (const name of JOB_NAMES)
    await boss.createQueue(name, { policy: "exclusive", retryLimit: 0, expireInSeconds: 120 });
}

export class PgBossJobQueue implements JobQueue {
  private readonly boss: Pick<PgBoss, "send">;
  constructor(boss: Pick<PgBoss, "send">) {
    this.boss = boss;
  }
  async enqueue(name: JobName, data: object, opts: EnqueueOptions = {}): Promise<void> {
    await this.boss.send(name, data, {
      ...(opts.startAfterSeconds !== undefined ? { startAfter: opts.startAfterSeconds } : {}),
      ...(opts.singletonKey ? { singletonKey: opts.singletonKey } : {}),
      retryLimit: opts.retryLimit ?? 0,
      ...(opts.transaction ? { db: transactionAdapter(opts.transaction) } : {}),
    });
  }
}

/** pg-boss が生成する投入用 SQL の $n を Drizzle のバインド値へ変換する。データは SQL に連結しない */
function transactionAdapter(transaction: Database) {
  return {
    async executeSql(statement: string, values: unknown[] = []) {
      const chunks = statement.split(/(\$\d+)/).map((part) => {
        if (!/^\$\d+$/.test(part)) return sql.raw(part);
        const index = Number(part.slice(1)) - 1;
        if (index < 0 || index >= values.length) throw new Error("invalid pg-boss parameter");
        return sql`${values[index]}`;
      });
      const result = await transaction.execute(sql.join(chunks, sql.raw("")));
      return { rows: result.rows };
    },
  };
}

/** API は投入だけを行い、worker と同じキューを使う。 */
export async function startCharacterQueue(
  connectionString: string,
  log: Pick<CharacterWorkerLog, "error">,
) {
  const boss = new PgBoss({ connectionString });
  boss.on("error", (err) => log.error({ err }, "character queue error"));
  try {
    await boss.start();
    await prepareCharacterQueues(boss);
  } catch (error) {
    await boss.stop({ graceful: false });
    throw error;
  }
  return {
    queue: new PgBossJobQueue(boss),
    stop: () => boss.stop({ graceful: true, timeout: 25_000 }),
  };
}

export type CharacterWorkerLog = {
  info: (fields: object, message: string) => void;
  error: (fields: object, message: string) => void;
};

/** 1 つの LodestoneSource を全ハンドラで共有する。停止は処理中のジョブを待ってから DB を閉じる */
export async function startCharacterWorker(options: {
  connectionString: string;
  /** テストでは新しいスキーマを使い、既存ジョブを触らない */
  queueSchema?: string;
  db: Database;
  lodestone: CharacterDeps["lodestone"];
  enabled: boolean;
  log: CharacterWorkerLog;
}) {
  const boss = new PgBoss({
    connectionString: options.connectionString,
    schema: options.queueSchema ?? "pgboss",
  });
  boss.on("error", (error) => options.log.error({ err: error }, "character queue error"));
  const queue = new PgBossJobQueue(boss);
  const deps: CharacterDeps = {
    db: options.db,
    lodestone: options.lodestone,
    jobs: queue,
    enabled: options.enabled,
  };
  try {
    await boss.start();
    await prepareCharacterQueues(boss);
    for (const name of options.enabled ? JOB_NAMES : []) {
      await boss.work(name, { batchSize: 1, pollingIntervalSeconds: 1 }, async (batch) => {
        for (const job of batch) {
          try {
            const result = await runCharacterJob(name, job.data, deps);
            options.log.info({ jobId: job.id, jobName: name, result }, "character job completed");
          } catch (error) {
            options.log.error({ err: error, jobId: job.id, jobName: name }, "character job failed");
            throw error;
          }
        }
      });
    }
    if (options.enabled)
      await boss.schedule(
        "character-sync-all",
        CHARACTER_SYNC_CRON,
        {},
        { tz: "Asia/Tokyo", singletonKey: "character-sync-all", retryLimit: 0 },
      );
  } catch (error) {
    await boss.stop({ graceful: false });
    throw error;
  }
  return {
    queue,
    boss,
    async stop() {
      await boss.stop({ graceful: true, timeout: 25_000 });
    },
  };
}
