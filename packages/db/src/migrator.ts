import { migrate } from "drizzle-orm/node-postgres/migrator";
import type { Database } from "./client.ts";

export const MIGRATIONS_FOLDER = new URL("../drizzle", import.meta.url).pathname;

/** このパッケージ同梱のマイグレーションを適用する。CLI (migrate.ts) とテスト用 DB の初期化で共用 */
export async function migrateDatabase(db: Database): Promise<void> {
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
}
