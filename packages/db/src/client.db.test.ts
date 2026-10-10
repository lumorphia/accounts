import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createDatabase } from "./client.ts";

const databaseUrl = process.env.DATABASE_URL;

describe.skipIf(!databaseUrl)("createDatabase (PostgreSQL)", () => {
  it("idle 接続がサーバー側から切られてもプロセスは落ちず、次のクエリは新しい接続で通る", async () => {
    // DB の再起動やフェイルオーバーで pg が idle クライアントに 'error' を出す。Pool に listener が無いと
    // Node はそれを unhandled として process を落とす (RM-30 の障害リハーサルで発覚)
    const logged: Error[] = [];
    const { db, pool, close } = createDatabase(databaseUrl!, {
      onIdleError: (e) => logged.push(e),
    });
    const { db: killer, close: closeKiller } = createDatabase(databaseUrl!);
    try {
      const { pid } = (await db.execute<{ pid: number }>(sql`select pg_backend_pid() as pid`))
        .rows[0]!;
      expect(pool.idleCount).toBe(1);
      const errors: unknown[] = [];
      const onUncaught = (e: unknown) => errors.push(e);
      process.on("uncaughtException", onUncaught);
      try {
        await killer.execute(sql`select pg_terminate_backend(${pid})`);
        // pool が切断に気づくのを待つ
        await new Promise((r) => setTimeout(r, 300));
        const again = (await db.execute<{ pid: number }>(sql`select pg_backend_pid() as pid`))
          .rows[0]!;
        expect(again.pid).not.toBe(pid);
      } finally {
        process.off("uncaughtException", onUncaught);
      }
      expect(errors).toEqual([]);
      expect(logged).toHaveLength(1);
    } finally {
      await close();
      await closeKiller();
    }
  });
});
