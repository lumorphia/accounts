import { and, asc, eq, gt, isNotNull, lte, or, isNull, schema } from "@lumorphia-accounts/db";
import { syncCharacter, verifyCharacter, type CharacterDeps } from "../domain/characters.ts";
import type { JobName } from "./queue.ts";

const WEEK_MS = 7 * 86_400_000;
const PAGE_SIZE = 200;
export const CHARACTER_SYNC_CRON = "0 4 * * 1";

/** 確認済み・有効な利用者だけ。取得を週 1 回に抑え、1 件ずつジョブに分ける */
export async function enqueueWeeklySyncs(
  deps: Pick<CharacterDeps, "db" | "jobs" | "enabled" | "now">,
): Promise<number> {
  if (!deps.enabled) return 0;
  const before = new Date((deps.now?.() ?? new Date()).getTime() - WEEK_MS);
  let after: string | undefined;
  let count = 0;
  while (true) {
    const rows = await deps.db
      .select({ id: schema.characters.id })
      .from(schema.characters)
      .innerJoin(schema.users, eq(schema.characters.userId, schema.users.id))
      .where(
        and(
          eq(schema.users.status, "active"),
          isNotNull(schema.characters.verifiedAt),
          or(isNull(schema.characters.lastSyncedAt), lte(schema.characters.lastSyncedAt, before)),
          after ? gt(schema.characters.id, after) : undefined,
        ),
      )
      .orderBy(asc(schema.characters.id))
      .limit(PAGE_SIZE);
    for (const row of rows) {
      await deps.jobs.enqueue(
        "character-sync",
        { characterId: row.id },
        { singletonKey: row.id, retryLimit: 0, startAfterSeconds: count * 2 },
      );
      count++;
    }
    if (rows.length < PAGE_SIZE) return count;
    after = rows.at(-1)!.id;
  }
}

export async function runCharacterJob(name: JobName, data: unknown, deps: CharacterDeps) {
  if (name === "character-sync-all") return enqueueWeeklySyncs(deps);
  const id = data && typeof data === "object" && "characterId" in data ? data.characterId : null;
  if (
    typeof id !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
  )
    throw new Error("invalid character job");
  return name === "character-verify" ? verifyCharacter(deps, id) : syncCharacter(deps, id);
}
