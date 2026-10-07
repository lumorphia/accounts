import { sql } from "drizzle-orm";
import { check, integer, pgTable, timestamp } from "drizzle-orm/pg-core";

/** Lodestone 全体の取得順と間隔。プロセスをまたいで 1 行を共有する。 */
export const lodestonePacing = pgTable(
  "lodestone_pacing",
  {
    id: integer("id").primaryKey(),
    finishedAt: timestamp("finished_at", { withTimezone: true })
      .notNull()
      .default(sql`'1970-01-01'::timestamptz`),
  },
  (t) => [check("lodestone_pacing_singleton", sql`${t.id} = 1`)],
);
