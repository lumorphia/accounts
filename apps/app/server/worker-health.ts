import { eq, schema, type Database } from "@lumorphia-accounts/db";

type WorkerName = "accounts" | "characters";
export async function recordWorkerHeartbeat(
  db: Database,
  name: WorkerName,
  enabled: boolean,
  seenAt = new Date(),
) {
  await db
    .insert(schema.workerHeartbeats)
    .values({ name, enabled, seenAt })
    .onConflictDoUpdate({ target: schema.workerHeartbeats.name, set: { enabled, seenAt } });
}

export async function readWorkerHealth(
  db: Database,
  required: Record<WorkerName, boolean>,
  now = new Date(),
) {
  const rows = await db.select().from(schema.workerHeartbeats);
  const state = (name: WorkerName): "ok" | "stale" | "disabled" => {
    if (!required[name]) return "disabled";
    const row = rows.find((row) => row.name === name);
    const age = row ? now.getTime() - row.seenAt.getTime() : Infinity;
    return row?.enabled && age >= 0 && age < 120_000 ? "ok" : "stale";
  };
  return { accounts: state("accounts"), characters: state("characters") };
}

/** 同時書き込みを作らず、終了時は進行中の DB 処理を待つ。 */
export async function startWorkerHeartbeat(
  db: Database,
  name: WorkerName,
  enabled: boolean,
  onError: () => void,
) {
  await recordWorkerHeartbeat(db, name, enabled);
  let pending: Promise<void> | undefined;
  const timer = setInterval(() => {
    pending ??= recordWorkerHeartbeat(db, name, enabled)
      .catch(onError)
      .finally(() => {
        pending = undefined;
      });
  }, 30_000);
  timer.unref();
  return async () => {
    clearInterval(timer);
    await pending;
    await db.delete(schema.workerHeartbeats).where(eq(schema.workerHeartbeats.name, name));
  };
}
