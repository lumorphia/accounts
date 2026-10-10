import { sql } from "drizzle-orm";
import type { Database } from "./client.ts";

/** DB が答えるかを確かめる (死活確認)。答えなければ例外 */
export async function pingDatabase(db: Database): Promise<void> {
  await db.execute(sql`select 1`);
}
