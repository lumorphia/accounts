/**
 * E2E 専用のデータベース。開発の DB (`DATABASE_URL`) と同じサーバーの `<DB 名>_e2e` を使う
 * (開発の DB に E2E の利用者を混ぜない。lumorphia/prismtone と同じ)。`E2E_DATABASE_URL` で明示もできる
 */
export const DEFAULT_DATABASE_URL = "postgres://accounts:accounts@localhost:5434/accounts";

export function e2eDatabaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  if (env.E2E_DATABASE_URL) return env.E2E_DATABASE_URL;
  const url = new URL(env.DATABASE_URL ?? DEFAULT_DATABASE_URL);
  url.pathname = `${url.pathname.replace(/\/$/, "")}_e2e`;
  return url.toString();
}
