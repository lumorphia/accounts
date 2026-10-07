import { and, asc, eq, isNull, lte, schema, sql } from "@lumorphia-accounts/db";
import type { ObjectStorage } from "@lumorphia/storage";
import { AVATAR_SIZES } from "@lumorphia/media";
import { PgBoss } from "pg-boss";
import { purgeAccounts, type AccountLifecycleDeps } from "../domain/account-deletion.ts";
import type { CharacterWorkerLog } from "./pg-boss.ts";

export type AccountEventRow = typeof schema.accountEvents.$inferSelect;
export type AccountDeliveryDeps = AccountLifecycleDeps & {
  sign: (event: AccountEventRow) => Promise<string>;
  fetch?: typeof fetch;
};
const retryAt = (now: Date, attempts: number) =>
  new Date(now.getTime() + Math.min(6 * 3600, 60 * 2 ** Math.min(attempts - 1, 12)) * 1000);

/** 順序と配達済みの記録を同じロックで保つ。失敗は捨てず、次回の日時を残す。 */
export async function deliverAccountEvents(deps: AccountDeliveryDeps, limit = 20): Promise<number> {
  let delivered = 0;
  for (let n = 0; n < limit; n++) {
    const result = await deps.db.transaction(async (tx) => {
      const now = deps.now?.() ?? new Date();
      const table = schema.accountEvents;
      const [row] = await tx
        .select()
        .from(table)
        .where(
          and(
            isNull(table.deliveredAt),
            lte(table.nextAttemptAt, now),
            sql`not exists (select 1 from account_events older where older.sub = ${table.sub} and older.client_id = ${table.clientId} and older.revision < ${table.revision} and older.delivered_at is null)`,
          ),
        )
        .orderBy(asc(table.createdAt), asc(table.id))
        .limit(1)
        .for("update", { skipLocked: true });
      if (!row) return null;
      let error: string | null = null;
      try {
        const url = new URL(row.endpoint);
        if (url.protocol !== "https:" || url.username || url.password || url.hash)
          throw new Error("invalid endpoint");
        const token = await deps.sign(row);
        const response = await (deps.fetch ?? fetch)(row.endpoint, {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ event_token: token }).toString(),
          redirect: "error",
          signal: AbortSignal.timeout(10_000),
        });
        // 応答の読み取りまで終えてから受付を確定する。
        await response.arrayBuffer();
        if (!response.ok) error = `http_${response.status}`;
      } catch {
        error = "delivery_failed";
      }
      const attempts = row.attempts + 1;
      await tx
        .update(table)
        .set({
          attempts,
          lastError: error,
          deliveredAt: error ? null : now,
          nextAttemptAt: retryAt(now, attempts),
        })
        .where(eq(table.id, row.id));
      return !error;
    });
    if (result === null) break;
    if (result) delivered++;
  }
  return delivered;
}
export async function deleteAccountAssets(
  deps: AccountLifecycleDeps & { storage: ObjectStorage },
  limit = 20,
): Promise<number> {
  let deleted = 0;
  for (let n = 0; n < limit; n++) {
    const result = await deps.db.transaction(async (tx) => {
      const now = deps.now?.() ?? new Date();
      const table = schema.assetDeletions;
      const [row] = await tx
        .select()
        .from(table)
        .where(and(isNull(table.deletedAt), lte(table.nextAttemptAt, now)))
        .orderBy(asc(table.createdAt), asc(table.id))
        .limit(1)
        .for("update", { skipLocked: true });
      if (!row) return null;
      let error: string | null = null;
      try {
        if (!/^avatars\/[0-9a-f-]{36}\/[0-9a-f]{16}$/.test(row.keyBase))
          throw new Error("invalid avatar key");
        await deps.storage.delete(AVATAR_SIZES.map((size) => `${row.keyBase}/${size}.webp`));
      } catch {
        error = "storage_failed";
      }
      const attempts = row.attempts + 1;
      await tx
        .update(table)
        .set({
          attempts,
          lastError: error,
          deletedAt: error ? null : now,
          nextAttemptAt: retryAt(now, attempts),
        })
        .where(eq(table.id, row.id));
      return !error;
    });
    if (result === null) break;
    if (result) deleted++;
  }
  return deleted;
}

/** 配送と画像削除が済んだ記録は 30 日後に消す。未完了の要求は保持する。 */
export async function cleanupAccountReceipts(deps: AccountLifecycleDeps) {
  const before = new Date((deps.now?.() ?? new Date()).getTime() - 30 * 86_400_000);
  await deps.db.delete(schema.accountEvents).where(lte(schema.accountEvents.deliveredAt, before));
  await deps.db.delete(schema.assetDeletions).where(lte(schema.assetDeletions.deletedAt, before));
}

export const ACCOUNT_MAINTENANCE_QUEUE = "account-maintenance";
export async function runAccountMaintenance(
  deps: AccountDeliveryDeps & { storage: ObjectStorage },
) {
  const purged = await purgeAccounts(deps);
  const assets = await deleteAccountAssets(deps);
  const delivered = await deliverAccountEvents(deps);
  await cleanupAccountReceipts(deps);
  return { purged, assets, delivered };
}
export async function startAccountWorker(options: {
  connectionString: string;
  queueSchema?: string;
  enabled: boolean;
  deps: AccountDeliveryDeps & { storage: ObjectStorage };
  log: CharacterWorkerLog;
}) {
  const boss = new PgBoss({
    connectionString: options.connectionString,
    schema: options.queueSchema ?? "pgboss",
  });
  boss.on("error", (err) => options.log.error({ err }, "account queue error"));
  try {
    await boss.start();
    await boss.createQueue(ACCOUNT_MAINTENANCE_QUEUE, {
      policy: "exclusive",
      retryLimit: 2,
      retryBackoff: true,
      expireInSeconds: 900,
    });
    if (options.enabled) {
      await boss.work(ACCOUNT_MAINTENANCE_QUEUE, { pollingIntervalSeconds: 1 }, async () => {
        const result = await runAccountMaintenance(options.deps);
        options.log.info(result, "account maintenance completed");
      });
      await boss.schedule(
        ACCOUNT_MAINTENANCE_QUEUE,
        "* * * * *",
        {},
        { tz: "Asia/Tokyo", singletonKey: "account-maintenance" },
      );
      await boss.send(ACCOUNT_MAINTENANCE_QUEUE, {}, { singletonKey: "account-maintenance" });
    }
  } catch (error) {
    await boss.stop({ graceful: false });
    throw error;
  }
  return { boss, stop: () => boss.stop({ graceful: true, timeout: 25_000 }) };
}
