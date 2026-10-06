import { ensureDatabase } from "@lumorphia-accounts/db/test-database";
import { DEFAULT_DATABASE_URL } from "./database.ts";

/**
 * E2E の DB を用意する (無ければ作り、マイグレーションを当てる)。Playwright は globalSetup より先に webServer を
 * 立ち上げるので、webServer のコマンドの先頭で走らせる (lumorphia/prismtone と同じ)。
 * DATABASE_URL は E2E の DB (アプリが使う)、E2E_BASE_DATABASE_URL はそれを作るための開発の DB
 */
const target = process.env.DATABASE_URL;
if (!target) throw new Error("DATABASE_URL (E2E の DB) が要る");
const name = new URL(target).pathname.slice(1);
await ensureDatabase(process.env.E2E_BASE_DATABASE_URL ?? DEFAULT_DATABASE_URL, name);
console.log(`e2e database ready: ${name}`);
