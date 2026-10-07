import { eq, schema, sql, type Database } from "@lumorphia-accounts/db";

export interface LodestonePacer {
  run<T>(request: () => Promise<T>): Promise<T>;
}

/** API と worker が同じ行をロックする。本文の受信が終わってから次の取得まで 1 秒空ける。 */
export class PostgresLodestonePacer implements LodestonePacer {
  private readonly db: Database;
  private readonly intervalMs: number;
  constructor(db: Database, intervalMs = 1000) {
    this.db = db;
    this.intervalMs = intervalMs;
  }

  async run<T>(request: () => Promise<T>): Promise<T> {
    const state = schema.lodestonePacing;
    const outcome = await this.db.transaction(async (tx) => {
      await tx.insert(state).values({ id: 1 }).onConflictDoNothing();
      await tx.select().from(state).where(eq(state.id, 1)).for("update");
      // プロセスの時計のずれを避け、DB の実時刻で待つ。トランザクション開始時刻は使わない。
      await tx.execute(sql`select pg_sleep(greatest(0, extract(epoch from
        ((select finished_at from lodestone_pacing where id = 1) + ${this.intervalMs} * interval '1 millisecond' - clock_timestamp()))))`);
      const result = await request().then(
        (value) => ({ ok: true as const, value }),
        (error: unknown) => ({ ok: false as const, error }),
      );
      await tx
        .update(state)
        .set({ finishedAt: sql`clock_timestamp()` })
        .where(eq(state.id, 1));
      return result;
    });
    // 失敗した取得も時刻を確定させてから呼び出し元に戻す。
    if (!outcome.ok) throw outcome.error;
    return outcome.value;
  }
}
