import { drizzle, type NodePgQueryResultHKT } from "drizzle-orm/node-postgres";
import type { PgDatabase } from "drizzle-orm/pg-core";
import pg from "pg";
import * as schema from "./schema/index.ts";

/** クエリ実行に必要な型。トランザクション (PgTransaction) も同じ型で受け取れる。 */
export type Database = PgDatabase<NodePgQueryResultHKT, typeof schema>;

export function createDatabase(
  connectionString: string,
  options: {
    /** idle 接続が切れたときの記録先。既定は console.error */
    onIdleError?: (error: Error) => void;
  } = {},
) {
  const pool = new pg.Pool({ connectionString, max: 10 });
  // DB の再起動やフェイルオーバーで idle 接続がサーバー側から切られると、pg は Pool に 'error' を出す。
  // listener が無いと Node が unhandled として process を落とすので、記録だけして次の取得で新しい接続を張らせる
  const onIdleError =
    options.onIdleError ?? ((error) => console.error("db: idle client error", error));
  pool.on("error", onIdleError);
  const db = drizzle({ client: pool, schema });
  return {
    db,
    pool,
    async close() {
      await pool.end();
    },
  };
}
