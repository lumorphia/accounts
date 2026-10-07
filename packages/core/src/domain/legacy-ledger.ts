import { createHash } from "node:crypto";
import { and, asc, eq, isNull, schema, sql, type Database } from "@lumorphia-accounts/db";
import { DomainError } from "./errors.ts";
import { validateHandle } from "./handle.ts";

type LegacyIdentity = { providerId: string; accountId: string };
export type LegacySnapshot = {
  service: "prismtone";
  accounts: { legacyUserId: string; handle: string; identities: LegacyIdentity[] }[];
};
const providers = ["discord", "google", "twitter", "misskey", "mastodon"];
function fail(code: DomainError["code"], message: string): never {
  throw new DomainError(code, message);
}
function object(value: unknown, keys: string[]): Record<string, unknown> {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some((k) => !keys.includes(k))
  )
    fail("validation", "invalid_legacy_snapshot");
  return value as Record<string, unknown>;
}
const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
/** 最小限の情報だけ受け取り、順序が違う同じ台帳は同じ digest にする。 */
export function parseLegacySnapshot(input: unknown): LegacySnapshot {
  const root = object(input, ["service", "accounts"]);
  if (
    root.service !== "prismtone" ||
    !Array.isArray(root.accounts) ||
    root.accounts.length > 100_000
  )
    fail("validation", "invalid_legacy_snapshot");
  const ids = new Set<string>(),
    handles = new Set<string>(),
    identities = new Set<string>();
  const accounts = root.accounts
    .map((value: unknown) => {
      const row = object(value, ["legacyUserId", "handle", "identities"]);
      if (
        typeof row.legacyUserId !== "string" ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(row.legacyUserId) ||
        typeof row.handle !== "string" ||
        !validateHandle(row.handle).ok ||
        !Array.isArray(row.identities) ||
        !row.identities.length ||
        row.identities.length > 1000
      )
        fail("validation", "invalid_legacy_snapshot");
      if (ids.has(row.legacyUserId) || handles.has(row.handle))
        fail("validation", "duplicate_legacy_account");
      ids.add(row.legacyUserId);
      handles.add(row.handle);
      const pairs = row.identities
        .map((value: unknown) => {
          const pair = object(value, ["providerId", "accountId"]);
          if (
            typeof pair.providerId !== "string" ||
            !providers.includes(pair.providerId) ||
            typeof pair.accountId !== "string" ||
            !pair.accountId.length ||
            pair.accountId.length > 512 ||
            pair.accountId.trim() !== pair.accountId ||
            /[\u0000-\u001f\u007f]/.test(pair.accountId) ||
            (["misskey", "mastodon"].includes(pair.providerId) &&
              !/^[^:\s/]+(?::[0-9]+)?:[^:\s/]+$/.test(pair.accountId))
          )
            fail("validation", "invalid_legacy_identity");
          const key = JSON.stringify([pair.providerId, pair.accountId]);
          if (identities.has(key)) fail("validation", "duplicate_legacy_identity");
          identities.add(key);
          return { providerId: pair.providerId, accountId: pair.accountId };
        })
        .sort((a, b) => compare(JSON.stringify(a), JSON.stringify(b)));
      return { legacyUserId: row.legacyUserId, handle: row.handle, identities: pairs };
    })
    .sort((a, b) => compare(a.legacyUserId, b.legacyUserId));
  return { service: "prismtone", accounts };
}
/** 台帳の取り込みと handle の取得を順序づける。利用者のロックより先に取る。 */
export async function withLegacyHandleLock<T>(
  db: Database,
  action: (tx: Database) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(15715, 1)`);
    return action(tx);
  });
}
async function matchingAccounts(db: Database, userId: string) {
  return db
    .select({ legacy: schema.legacyAccounts })
    .from(schema.legacyAccounts)
    .innerJoin(
      schema.legacyIdentities,
      eq(schema.legacyIdentities.legacyAccountId, schema.legacyAccounts.id),
    )
    .innerJoin(
      schema.accounts,
      and(
        eq(schema.accounts.providerId, schema.legacyIdentities.providerId),
        eq(schema.accounts.accountId, schema.legacyIdentities.accountId),
      ),
    )
    .where(
      and(
        eq(schema.accounts.userId, userId),
        isNull(schema.legacyAccounts.migratedAt),
        eq(schema.legacyAccounts.service, "prismtone"),
      ),
    )
    .orderBy(asc(schema.legacyAccounts.handle));
}
export async function listLegacyPending(db: Database, userId: string) {
  const matches = await matchingAccounts(db, userId);
  return [
    ...new Map(
      matches.map(({ legacy }) => [
        legacy.id,
        { service: "prismtone" as const, handle: legacy.handle },
      ]),
    ).values(),
  ];
}
export async function legacyPendingServices(db: Database, userId: string) {
  return [...new Set((await listLegacyPending(db, userId)).map((row) => row.service))].sort();
}
export async function assertLegacyHandleAccess(
  db: Database,
  handle: string,
  userId: string | null,
) {
  const reserved = await db.query.legacyAccounts.findFirst({
    where: and(eq(schema.legacyAccounts.handle, handle), isNull(schema.legacyAccounts.migratedAt)),
  });
  if (!reserved) return;
  if (
    !userId ||
    !(await matchingAccounts(db, userId)).some(({ legacy }) => legacy.id === reserved.id)
  )
    fail("conflict", "handle is reserved");
}
export async function importLegacyLedger(
  db: Database,
  input: unknown,
  now = new Date(),
  options: { dryRun?: boolean } = {},
) {
  const snapshot = parseLegacySnapshot(input);
  const digest = createHash("sha256").update(JSON.stringify(snapshot)).digest("hex");
  return withLegacyHandleLock(db, async (tx) => {
    const previous = await tx.query.legacyImports.findFirst({
      where: eq(schema.legacyImports.service, snapshot.service),
    });
    if (previous) {
      if (previous.digest !== digest) fail("conflict", "legacy_snapshot_already_imported");
      return { imported: previous.importedCount, repeated: true };
    }
    for (const row of snapshot.accounts) {
      const owner = await tx.query.users.findFirst({
        where: eq(schema.users.handle, row.handle),
        columns: { id: true },
      });
      if (owner) {
        const linked = await tx.query.accounts.findMany({
          where: eq(schema.accounts.userId, owner.id),
          columns: { providerId: true, accountId: true },
        });
        if (
          !row.identities.some((pair) =>
            linked.some((p) => p.providerId === pair.providerId && p.accountId === pair.accountId),
          )
        )
          fail("conflict", "legacy_handle_occupied");
      }
    }
    if (options.dryRun) return { imported: snapshot.accounts.length, repeated: false };
    for (const row of snapshot.accounts) {
      const [account] = await tx
        .insert(schema.legacyAccounts)
        .values({ service: snapshot.service, legacyUserId: row.legacyUserId, handle: row.handle })
        .returning({ id: schema.legacyAccounts.id });
      await tx.insert(schema.legacyIdentities).values(
        row.identities.map((pair) => ({
          ...pair,
          service: snapshot.service,
          legacyAccountId: account!.id,
        })),
      );
    }
    await tx.insert(schema.legacyImports).values({
      service: snapshot.service,
      digest,
      importedCount: snapshot.accounts.length,
      importedAt: now,
    });
    return { imported: snapshot.accounts.length, repeated: false };
  });
}
export async function completeLegacyMigration(
  db: Database,
  userId: string,
  legacyUserId: string,
  handleChoice: "legacy" | "current",
  now = new Date(),
) {
  if (!["legacy", "current"].includes(handleChoice)) fail("validation", "invalid_handle_choice");
  return withLegacyHandleLock(db, async (tx) => {
    const [user] = await tx
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .for("update");
    if (!user || user.status !== "active") fail("forbidden", "account_not_active");
    const row = await tx.query.legacyAccounts.findFirst({
      where: and(
        eq(schema.legacyAccounts.service, "prismtone"),
        eq(schema.legacyAccounts.legacyUserId, legacyUserId),
      ),
    });
    if (!row) fail("not_found", "legacy_account_not_found");
    if (row.migratedAt) {
      if (row.migratedTo !== userId || row.handleChoice !== handleChoice)
        fail("conflict", "legacy_account_already_migrated");
      return { handle: user.handle, alreadyCompleted: true };
    }
    if (!(await matchingAccounts(tx, userId)).some(({ legacy }) => legacy.id === row.id))
      fail("forbidden", "legacy_identity_required");
    const mapped = await tx.query.legacyAccounts.findFirst({
      where: and(
        eq(schema.legacyAccounts.service, "prismtone"),
        eq(schema.legacyAccounts.migratedTo, userId),
      ),
    });
    if (mapped) fail("conflict", "service_already_migrated");
    const handle = handleChoice === "legacy" ? row.handle : user.handle;
    if (handle !== user.handle) {
      const taken = await tx.query.users.findFirst({
        where: eq(schema.users.handle, handle),
        columns: { id: true },
      });
      if (taken) fail("conflict", "handle is taken");
      await tx
        .update(schema.users)
        .set({ handle, handleChangedAt: now })
        .where(eq(schema.users.id, userId));
    }
    await tx
      .update(schema.legacyAccounts)
      .set({ migratedAt: now, migratedTo: userId, handleChoice })
      .where(eq(schema.legacyAccounts.id, row.id));
    return { handle, alreadyCompleted: false };
  });
}
/** 旧サービスの物理削除を運営者が確認したあとに呼ぶ。復旧期間中には解放しない。 */
export async function releaseLegacyAccount(db: Database, legacyUserId: string) {
  return withLegacyHandleLock(db, async (tx) => {
    const deleted = await tx
      .delete(schema.legacyAccounts)
      .where(
        and(
          eq(schema.legacyAccounts.service, "prismtone"),
          eq(schema.legacyAccounts.legacyUserId, legacyUserId),
        ),
      )
      .returning({ id: schema.legacyAccounts.id });
    return { released: deleted.length > 0 };
  });
}
