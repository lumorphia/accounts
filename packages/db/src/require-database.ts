/**
 * DB テストが読む DATABASE_URL。手元に PostgreSQL が無いときは undefined を返し、DB テストは skip される。
 * CI では skip させない。lumorphia/prismtone では DATABASE_URL が無いと DB テストが skip されて緑になり、
 * 確かめていないのに通ったように見えた (prismtone の AGENTS.md「テストの落とし穴」)
 */
export function databaseUrlForTest(env: Record<string, string | undefined>): string | undefined {
  const url = env.DATABASE_URL;
  if (!url && env.CI) throw new Error("CI では DATABASE_URL が要る (DB テストを skip させない)");
  return url;
}
