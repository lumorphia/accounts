import { expect } from "vitest";
import { databaseUrlForTest } from "./require-database.ts";
import { ensureTestDatabase } from "./test-database.ts";

/**
 * vitest の setupFiles。`*.db.test.ts` を読み込む前に、そのファイル専用の DB を用意して
 * DATABASE_URL を差し替える (lumorphia/prismtone と同じ)。テストファイルは module の先頭で
 * process.env.DATABASE_URL を読むだけでよい。手元で DATABASE_URL が無ければ何もしない (skip される)。
 * CI で無ければ失敗させる (require-database.ts)
 */
const testPath = expect.getState().testPath;
if (testPath?.endsWith(".db.test.ts")) {
  const base = databaseUrlForTest(process.env);
  if (base) process.env.DATABASE_URL = await ensureTestDatabase(base, testPath);
}
