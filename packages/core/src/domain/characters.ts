import { randomBytes } from "node:crypto";
import { and, asc, eq, isNotNull, ne, schema, sql, type Database } from "@lumorphia-accounts/db";
import {
  LodestoneError,
  type LodestoneCharacter,
  type LodestoneSource,
} from "../adapters/lodestone/types.ts";
import type { JobQueue } from "../jobs/queue.ts";
import { DomainError } from "./errors.ts";

export const TOKEN_PREFIX = "lumorphia-";
export const TOKEN_TTL_MS = 86_400_000;
export const MANUAL_SYNC_INTERVAL_MS = 86_400_000;
export const MAX_CHARACTERS_PER_USER = 40;
export const SYNC_FAILURES_BEFORE_ERROR = 3;
export type CharacterDeps = {
  db: Database;
  lodestone: LodestoneSource;
  jobs: JobQueue;
  enabled: boolean;
  now?: () => Date;
};
type Row = typeof schema.characters.$inferSelect;
export type CharacterView = ReturnType<typeof toCharacterView>;
const currentTime = (deps: Pick<CharacterDeps, "now">) => deps.now?.() ?? new Date();
export const newToken = () => `${TOKEN_PREFIX}${randomBytes(4).toString("hex")}`;

export function parseLodestoneId(input: string): string | null {
  const value = input.trim();
  if (/^[1-9]\d{0,11}$/.test(value)) return value;
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.port ||
      !/^(jp|na|eu|fr|de)\.finalfantasyxiv\.com$/.test(url.hostname)
    )
      return null;
    return /^\/lodestone\/character\/([1-9]\d{0,11})\/?$/.exec(url.pathname)?.[1] ?? null;
  } catch {
    return null;
  }
}

export function toCharacterView(row: Row, now = new Date()) {
  const valid =
    !row.verifiedAt &&
    row.verificationToken &&
    row.verificationExpiresAt &&
    row.verificationExpiresAt > now;
  return {
    id: row.id,
    lodestoneId: row.lodestoneId,
    name: row.name,
    world: row.world,
    dataCenter: row.dataCenter,
    race: row.race,
    clan: row.clan,
    gender: row.gender,
    avatarUrl: row.avatarUrl,
    isPrimary: row.isPrimary,
    verified: row.verifiedAt !== null,
    verifiedAt: row.verifiedAt?.toISOString() ?? null,
    verification: valid
      ? { token: row.verificationToken!, expiresAt: row.verificationExpiresAt!.toISOString() }
      : null,
    verificationError: row.verificationError,
    verificationCheckedAt: row.verificationCheckedAt?.toISOString() ?? null,
    lastSyncedAt: row.lastSyncedAt?.toISOString() ?? null,
    syncError: row.syncError,
  };
}
export async function listCharacters(
  db: Database,
  userId: string,
  now = new Date(),
): Promise<CharacterView[]> {
  const rows = await db
    .select()
    .from(schema.characters)
    .where(eq(schema.characters.userId, userId))
    .orderBy(asc(schema.characters.createdAt), asc(schema.characters.id));
  return rows.map((row) => toCharacterView(row, now));
}
function fail(code: DomainError["code"], message: string): never {
  throw new DomainError(code, message);
}
function requireEnabled(deps: CharacterDeps) {
  if (!deps.enabled) fail("forbidden", "lodestone_disabled");
}
async function lockOwner(db: Database, userId: string) {
  const [owner] = await db
    .select({ status: schema.users.status })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .for("update");
  if (!owner) fail("not_found", "user_not_found");
  if (owner.status !== "active") fail("forbidden", "account_not_active");
}
async function ownCharacter(db: Database, userId: string, characterId: string): Promise<Row> {
  const row = await db.query.characters.findFirst({
    where: and(eq(schema.characters.id, characterId), eq(schema.characters.userId, userId)),
  });
  if (!row) fail("not_found", "character_not_found");
  return row;
}
function fieldsFrom(c: LodestoneCharacter) {
  return {
    name: c.name,
    world: c.world,
    dataCenter: c.dataCenter,
    race: c.race ?? c.rawRace,
    clan: c.clan,
    gender: c.gender,
    avatarUrl: c.avatarUrl,
  };
}
function upstreamError(error: unknown): never {
  if (error instanceof LodestoneError)
    fail(
      error.code === "not_found" ? "not_found" : "upstream_unavailable",
      error.code === "not_found" ? "lodestone_character_not_found" : error.code,
    );
  throw error;
}
export type RegisterCharacterInput = { lodestone: string } | { name: string; world: string };
export async function registerCharacter(
  deps: CharacterDeps,
  userId: string,
  input: RegisterCharacterInput,
): Promise<CharacterView> {
  requireEnabled(deps);
  // 外部取得を始める前にも状態を見る。確定時にはロックして最新の状態と件数を確かめる
  const owner = await deps.db.query.users.findFirst({ where: eq(schema.users.id, userId) });
  if (!owner || owner.status !== "active") fail("forbidden", "account_not_active");
  const existing = await listCharacters(deps.db, userId, currentTime(deps));
  if (existing.length >= MAX_CHARACTERS_PER_USER) fail("validation", "too_many_characters");
  let id: string;
  if ("lodestone" in input) {
    const parsed = parseLodestoneId(input.lodestone);
    if (!parsed) fail("validation", "invalid_lodestone_url");
    id = parsed;
  } else {
    const name = input.name.trim();
    const world = input.world.trim();
    if (!name || name.length > 40 || !/^[A-Za-z]{1,40}$/.test(world))
      fail("validation", "invalid_character_search");
    const hits = await deps.lodestone.searchCharacter(name, world).catch(upstreamError);
    const exact = hits.filter(
      (hit) => hit.name.toLowerCase() === name.toLowerCase() && hit.world === world,
    );
    if (exact.length !== 1)
      fail("validation", exact.length ? "ambiguous_character" : "character_not_found");
    id = exact[0]!.lodestoneId;
  }
  if (existing.some((c) => c.lodestoneId === id)) fail("conflict", "already_registered");
  const fetched = await deps.lodestone.fetchCharacter(id).catch(upstreamError);
  return deps.db.transaction(async (tx) => {
    await lockOwner(tx, userId);
    const latest = await listCharacters(tx, userId, currentTime(deps));
    if (latest.some((c) => c.lodestoneId === id)) fail("conflict", "already_registered");
    if (latest.length >= MAX_CHARACTERS_PER_USER) fail("validation", "too_many_characters");
    const now = currentTime(deps);
    const [row] = await tx
      .insert(schema.characters)
      .values({
        userId,
        lodestoneId: id,
        ...fieldsFrom(fetched),
        isPrimary: latest.length === 0,
        verificationToken: newToken(),
        verificationExpiresAt: new Date(now.getTime() + TOKEN_TTL_MS),
      })
      .returning();
    return toCharacterView(row!, now);
  });
}
export async function reissueToken(
  deps: CharacterDeps,
  userId: string,
  characterId: string,
): Promise<CharacterView> {
  requireEnabled(deps);
  return deps.db.transaction(async (tx) => {
    await lockOwner(tx, userId);
    const row = await ownCharacter(tx, userId, characterId);
    if (row.verifiedAt) fail("conflict", "already_verified");
    const now = currentTime(deps);
    const [updated] = await tx
      .update(schema.characters)
      .set({
        verificationToken: newToken(),
        verificationExpiresAt: new Date(now.getTime() + TOKEN_TTL_MS),
        verificationError: null,
        verificationCheckedAt: null,
      })
      .where(eq(schema.characters.id, characterId))
      .returning();
    return toCharacterView(updated!, now);
  });
}
export type VerifyResult =
  | "verified"
  | "token_not_found"
  | "token_expired"
  | "already_verified_by_another_user"
  | "lodestone_error"
  | "skipped";
export async function checkVerification(deps: CharacterDeps, userId: string, characterId: string) {
  requireEnabled(deps);
  const row = await ownCharacter(deps.db, userId, characterId);
  if (row.verifiedAt) fail("conflict", "already_verified");
  if (
    !row.verificationToken ||
    !row.verificationExpiresAt ||
    row.verificationExpiresAt <= currentTime(deps)
  )
    fail("conflict", "token_expired");
  const result = await verifyCharacter(deps, characterId);
  return {
    result,
    character: toCharacterView(await ownCharacter(deps.db, userId, characterId), currentTime(deps)),
  };
}
export async function verifyCharacter(
  deps: CharacterDeps,
  characterId: string,
): Promise<VerifyResult> {
  if (!deps.enabled) return "skipped";
  const initial = await deps.db.query.characters.findFirst({
    where: eq(schema.characters.id, characterId),
  });
  if (!initial || initial.verifiedAt) return "skipped";
  const owner = await deps.db.query.users.findFirst({ where: eq(schema.users.id, initial.userId) });
  if (!owner || owner.status !== "active") return "skipped";
  let fetched: LodestoneCharacter | null = null;
  if (
    initial.verificationToken &&
    initial.verificationExpiresAt &&
    initial.verificationExpiresAt > currentTime(deps)
  ) {
    try {
      fetched = await deps.lodestone.fetchCharacter(initial.lodestoneId);
    } catch (error) {
      if (!(error instanceof LodestoneError)) throw error;
    }
  }
  return deps.db.transaction(async (tx) => {
    const [owner] = await tx
      .select({ status: schema.users.status })
      .from(schema.users)
      .where(eq(schema.users.id, initial.userId))
      .for("update");
    if (!owner || owner.status !== "active") return "skipped";
    // 利用者が違っても同じ Lodestone ID の確定を直列化する
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${"accounts-character:" + initial.lodestoneId},0))`,
    );
    const row = await tx.query.characters.findFirst({
      where: eq(schema.characters.id, characterId),
    });
    if (!row || row.verifiedAt || row.verificationToken !== initial.verificationToken)
      return "skipped";
    const now = currentTime(deps);
    let error: VerifyResult | null = null;
    if (!row.verificationToken || !row.verificationExpiresAt || row.verificationExpiresAt <= now)
      error = "token_expired";
    else if (!fetched) error = "lodestone_error";
    else if (
      !new RegExp(`(?<![\\w-])${row.verificationToken}(?![\\w-])`).test(fetched.selfIntroduction)
    )
      error = "token_not_found";
    else if (
      await tx.query.characters.findFirst({
        where: and(
          eq(schema.characters.lodestoneId, row.lodestoneId),
          isNotNull(schema.characters.verifiedAt),
          ne(schema.characters.id, characterId),
        ),
      })
    )
      error = "already_verified_by_another_user";
    if (error) {
      await tx
        .update(schema.characters)
        .set({ verificationError: error, verificationCheckedAt: now })
        .where(eq(schema.characters.id, characterId));
      return error;
    }
    await tx
      .update(schema.characters)
      .set({
        ...fieldsFrom(fetched!),
        verifiedAt: now,
        verificationToken: null,
        verificationExpiresAt: null,
        verificationError: null,
        verificationCheckedAt: now,
        lastSyncedAt: now,
        syncError: null,
        syncFailures: 0,
      })
      .where(eq(schema.characters.id, characterId));
    return "verified";
  });
}
export async function setPrimaryCharacter(
  db: Database,
  userId: string,
  characterId: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    await lockOwner(tx, userId);
    await ownCharacter(tx, userId, characterId);
    await tx
      .update(schema.characters)
      .set({ isPrimary: false })
      .where(eq(schema.characters.userId, userId));
    await tx
      .update(schema.characters)
      .set({ isPrimary: true })
      .where(eq(schema.characters.id, characterId));
  });
}
export async function deleteCharacter(
  db: Database,
  userId: string,
  characterId: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    await lockOwner(tx, userId);
    const row = await ownCharacter(tx, userId, characterId);
    await tx.delete(schema.characters).where(eq(schema.characters.id, characterId));
    if (row.isPrimary) {
      const [next] = await tx
        .select()
        .from(schema.characters)
        .where(eq(schema.characters.userId, userId))
        .orderBy(asc(schema.characters.createdAt), asc(schema.characters.id))
        .limit(1);
      if (next)
        await tx
          .update(schema.characters)
          .set({ isPrimary: true })
          .where(eq(schema.characters.id, next.id));
    }
  });
}
export async function requestSync(
  deps: CharacterDeps,
  userId: string,
  characterId: string,
): Promise<void> {
  requireEnabled(deps);
  await deps.db.transaction(async (tx) => {
    await lockOwner(tx, userId);
    const row = await ownCharacter(tx, userId, characterId);
    if (!row.verifiedAt) fail("conflict", "not_verified");
    const now = currentTime(deps);
    if (
      [row.lastSyncedAt, row.syncRequestedAt].some(
        (time) => time && now.getTime() - time.getTime() < MANUAL_SYNC_INTERVAL_MS,
      )
    )
      fail("rate_limited", "sync_too_soon");
    await tx
      .update(schema.characters)
      .set({ syncRequestedAt: now })
      .where(eq(schema.characters.id, characterId));
    await deps.jobs.enqueue(
      "character-sync",
      { characterId },
      { singletonKey: characterId, retryLimit: 0, transaction: tx },
    );
  });
}
export async function syncCharacter(
  deps: CharacterDeps,
  characterId: string,
): Promise<"synced" | "failed" | "skipped"> {
  if (!deps.enabled) return "skipped";
  const initial = await deps.db.query.characters.findFirst({
    where: eq(schema.characters.id, characterId),
  });
  if (!initial || !initial.verifiedAt) return "skipped";
  // 同じ利用者の同期・主キャラ変更・削除は同じロック順。取得中の削除と古い結果の復活を防ぐ
  return deps.db.transaction(async (tx) => {
    const [owner] = await tx
      .select({ status: schema.users.status })
      .from(schema.users)
      .where(eq(schema.users.id, initial.userId))
      .for("update");
    if (!owner || owner.status !== "active") return "skipped";
    const row = await tx.query.characters.findFirst({
      where: eq(schema.characters.id, characterId),
    });
    if (!row || !row.verifiedAt) return "skipped";
    let fetched: LodestoneCharacter;
    try {
      fetched = await deps.lodestone.fetchCharacter(row.lodestoneId);
    } catch (error) {
      if (!(error instanceof LodestoneError)) throw error;
      const failures = row.syncFailures + 1;
      await tx
        .update(schema.characters)
        .set({
          syncFailures: failures,
          syncError: failures >= SYNC_FAILURES_BEFORE_ERROR ? error.code : row.syncError,
        })
        .where(eq(schema.characters.id, characterId));
      return "failed";
    }
    await tx
      .update(schema.characters)
      .set({
        ...fieldsFrom(fetched),
        lastSyncedAt: currentTime(deps),
        syncError: null,
        syncFailures: 0,
      })
      .where(eq(schema.characters.id, characterId));
    return "synced";
  });
}
