import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { createDatabase } from "./client.ts";
import { migrateDatabase } from "./migrator.ts";

/**
 * テストファイルごとの専用データベース。
 * 共有 DB を並列で叩くと、片方の投稿を相手の検索が拾ったり、モデレーションログの順番が混ざったり、
 * 手元の DB に入れた辞書がテストの乱数タイトルに当たったりする。ファイル単位で DB を分ければ、
 * テストは自分の入れたものだけを見ればよく、テーブルの全削除もできる。
 *
 * 名前は `<元の DB 名>_t_<ファイル名>_<パスのハッシュ>`。無ければ作り、毎回マイグレーションを当てる
 * (適用済みの分は drizzle が飛ばすので速い)。作った DB は消さずに次回も使う。
 */
export async function ensureTestDatabase(baseUrl: string, testPath: string): Promise<string> {
  const url = new URL(baseUrl);
  return ensureDatabase(baseUrl, testDatabaseName(url.pathname.slice(1), testPath));
}

/**
 * baseUrl と同じサーバーに name のデータベースを用意し (無ければ作る)、マイグレーションを当てて、その URL を返す。
 * E2E は `<元の DB 名>_e2e` をこれで持つ (開発の DB に E2E の投稿や利用者を混ぜないため)
 */
export async function ensureDatabase(baseUrl: string, name: string): Promise<string> {
  const url = new URL(baseUrl);
  const admin = createDatabase(baseUrl);
  try {
    const found = await admin.db.execute(sql`select 1 from pg_database where datname = ${name}`);
    if (found.rows.length === 0) await admin.db.execute(sql.raw(`create database "${name}"`));
  } finally {
    await admin.close();
  }
  url.pathname = `/${name}`;
  const isolated = createDatabase(url.toString());
  try {
    await migrateDatabase(isolated.db);
  } finally {
    await isolated.close();
  }
  return url.toString();
}

/** PostgreSQL の識別子は 63 バイトまで。ファイル名で読めるようにしつつ、パスのハッシュで衝突を避ける */
export function testDatabaseName(baseName: string, testPath: string): string {
  const file = testPath
    .split("/")
    .at(-1)!
    .replace(/\.db\.test\.ts$/, "")
    .replace(/[^a-z0-9]+/gi, "_")
    .toLowerCase()
    .slice(0, 32);
  const hash = createHash("sha1").update(testPath).digest("hex").slice(0, 8);
  const prefix = `${baseName}_t_`.slice(0, 63 - file.length - 9);
  return `${prefix}${file}_${hash}`;
}
