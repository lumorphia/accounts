import {
  and,
  asc,
  eq,
  isNotNull,
  isNull,
  lte,
  ne,
  schema,
  type Database,
} from "@lumorphia-accounts/db";
import { DomainError } from "./errors.ts";

export const ACCOUNT_RECOVERY_MS = 30 * 86_400_000;
export const SERVICES = ["prismtone", "scenote", "facetia"] as const;
export type Service = (typeof SERVICES)[number];
export type AccountLifecycleDeps = { db: Database; now?: () => Date };
type User = typeof schema.users.$inferSelect;
type Membership = typeof schema.serviceMemberships.$inferSelect;
const time = (deps: AccountLifecycleDeps) => deps.now?.() ?? new Date();
const deadline = (deletedAt: Date) => new Date(deletedAt.getTime() + ACCOUNT_RECOVERY_MS);
function fail(code: DomainError["code"], message: string): never {
  throw new DomainError(code, message);
}
function checkService(service: string): asserts service is Service {
  if (!(SERVICES as readonly string[]).includes(service)) fail("validation", "unknown_service");
}
async function lockOwner(db: Database, userId: string) {
  const [user] = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .for("update");
  if (!user) fail("not_found", "user_not_found");
  return user;
}
function requireActive(user: User) {
  if (user.status !== "active") fail("forbidden", "account_not_active");
}
function confirm(user: User, input: string) {
  if (input !== user.handle) fail("validation", "confirm_must_match_handle");
}

/** 以前のクライアント設定も、残っている認可・トークンから利用先を拾う。 */
async function discoverServices(db: Database, userId: string) {
  const clients = await db
    .select({ name: schema.oauthClients.name })
    .from(schema.oauthAccessTokens)
    .innerJoin(
      schema.oauthClients,
      eq(schema.oauthAccessTokens.clientId, schema.oauthClients.clientId),
    )
    .where(eq(schema.oauthAccessTokens.userId, userId));
  const consents = await db
    .select({ name: schema.oauthClients.name })
    .from(schema.oauthConsents)
    .innerJoin(schema.oauthClients, eq(schema.oauthConsents.clientId, schema.oauthClients.clientId))
    .where(eq(schema.oauthConsents.userId, userId));
  for (const name of new Set([...clients, ...consents].map((c) => c.name))) {
    if (name && (SERVICES as readonly string[]).includes(name))
      await db
        .insert(schema.serviceMemberships)
        .values({ userId, service: name })
        .onConflictDoNothing();
  }
}
function snapshot(user: Pick<User, "status" | "deletedAt">, membership: Membership) {
  if (membership.purgedAt) return { state: "purged" as const, deletedAt: null, recoverUntil: null };
  const dates = [membership.deletedAt, user.status === "deleted" ? user.deletedAt : null].filter(
    (d): d is Date => d !== null,
  );
  const deletedAt = dates.length ? new Date(Math.min(...dates.map((d) => d.getTime()))) : null;
  return {
    state: deletedAt ? ("deleted" as const) : ("active" as const),
    deletedAt,
    recoverUntil: deletedAt ? deadline(deletedAt) : null,
  };
}
async function emit(
  db: Database,
  user: User,
  membership: Membership,
  scope: "account" | "service",
  now: Date,
  forcePurge = false,
) {
  const revision = membership.revision + 1;
  await db
    .update(schema.serviceMemberships)
    .set({ revision })
    .where(eq(schema.serviceMemberships.id, membership.id));
  const clients = await db.query.oauthClients.findMany({
    where: eq(schema.oauthClients.name, membership.service),
  });
  const state = forcePurge
    ? { state: "purged" as const, deletedAt: null, recoverUntil: null }
    : snapshot(user, membership);
  for (const client of clients) {
    const metadata = client.metadata as Record<string, unknown> | null;
    const endpoint =
      typeof metadata?.lifecycle_uri === "string"
        ? metadata.lifecycle_uri
        : new URL("/api/lumorphia/account-events", client.redirectUris[0]!).href;
    await db.insert(schema.accountEvents).values({
      sub: user.id,
      service: membership.service,
      clientId: client.clientId,
      endpoint,
      revision,
      scope,
      occurredAt: now,
      nextAttemptAt: now,
      ...state,
    });
  }
  return { ...membership, revision };
}
async function revokeTokens(db: Database, userId: string, service?: Service) {
  const clients = service
    ? await db.query.oauthClients.findMany({
        where: eq(schema.oauthClients.name, service),
        columns: { clientId: true },
      })
    : null;
  if (clients) {
    for (const client of clients) {
      await db
        .delete(schema.oauthAccessTokens)
        .where(
          and(
            eq(schema.oauthAccessTokens.userId, userId),
            eq(schema.oauthAccessTokens.clientId, client.clientId),
          ),
        );
      await db
        .delete(schema.oauthRefreshTokens)
        .where(
          and(
            eq(schema.oauthRefreshTokens.userId, userId),
            eq(schema.oauthRefreshTokens.clientId, client.clientId),
          ),
        );
    }
  } else {
    await db.delete(schema.oauthAccessTokens).where(eq(schema.oauthAccessTokens.userId, userId));
    await db.delete(schema.oauthRefreshTokens).where(eq(schema.oauthRefreshTokens.userId, userId));
    await db.delete(schema.sessions).where(eq(schema.sessions.userId, userId));
  }
}
async function membership(db: Database, userId: string, service: Service) {
  const row = await db.query.serviceMemberships.findFirst({
    where: and(
      eq(schema.serviceMemberships.userId, userId),
      eq(schema.serviceMemberships.service, service),
    ),
  });
  if (!row) fail("not_found", "service_not_used");
  return row;
}
export async function listServices(deps: AccountLifecycleDeps, userId: string) {
  return deps.db.transaction(async (tx) => {
    const user = await lockOwner(tx, userId);
    requireActive(user);
    await discoverServices(tx, userId);
    const rows = await tx.query.serviceMemberships.findMany({
      where: eq(schema.serviceMemberships.userId, userId),
      orderBy: (t, { asc }) => [asc(t.service)],
    });
    return rows.map((row) => {
      const view = snapshot(user, row);
      return {
        service: row.service,
        state: view.state,
        revision: row.revision,
        deletedAt: view.deletedAt?.toISOString() ?? null,
        recoverUntil: view.recoverUntil?.toISOString() ?? null,
      };
    });
  });
}
export async function deleteLumorphiaAccount(
  deps: AccountLifecycleDeps,
  userId: string,
  confirmation: string,
) {
  await deps.db.transaction(async (tx) => {
    const user = await lockOwner(tx, userId);
    requireActive(user);
    confirm(user, confirmation);
    if (user.role === "admin") fail("forbidden", "administrator_cannot_delete");
    await discoverServices(tx, userId);
    const now = time(deps);
    const deleted = { ...user, status: "deleted" as const, deletedAt: now };
    await tx
      .update(schema.users)
      .set({ status: "deleted", deletedAt: now, image: null, avatarKeyBase: null })
      .where(eq(schema.users.id, userId));
    await tx
      .update(schema.accounts)
      .set({ imageUrl: null })
      .where(eq(schema.accounts.userId, userId));
    if (user.avatarKeyBase)
      await tx
        .insert(schema.assetDeletions)
        .values({ sub: userId, keyBase: user.avatarKeyBase, nextAttemptAt: now })
        .onConflictDoNothing();
    await revokeTokens(tx, userId);
    const rows = await tx.query.serviceMemberships.findMany({
      where: eq(schema.serviceMemberships.userId, userId),
    });
    for (const row of rows) await emit(tx, deleted, row, "account", now);
  });
}
/** セッション作成の前に呼ぶ。期限内の退会済みは入れるが、状態は変えない (復旧は本人の操作で行う)。 */
export async function assertLoginAllowed(deps: AccountLifecycleDeps, userId: string) {
  const user = await deps.db.query.users.findFirst({
    columns: { status: true, deletedAt: true },
    where: eq(schema.users.id, userId),
  });
  if (user?.status !== "deleted") return;
  if (!user.deletedAt || deadline(user.deletedAt) <= time(deps))
    fail("forbidden", "recovery_expired");
}
export async function restoreLumorphiaAccount(deps: AccountLifecycleDeps, userId: string) {
  await deps.db.transaction(async (tx) => {
    const user = await lockOwner(tx, userId);
    if (user.status !== "deleted") fail("conflict", "account_not_deleted");
    const now = time(deps);
    if (!user.deletedAt || deadline(user.deletedAt) <= now) fail("forbidden", "recovery_expired");
    const restored = { ...user, status: "active" as const, deletedAt: null };
    await tx
      .update(schema.users)
      .set({ status: "active", deletedAt: null, restoredAt: now })
      .where(eq(schema.users.id, userId));
    const rows = await tx.query.serviceMemberships.findMany({
      where: eq(schema.serviceMemberships.userId, userId),
    });
    for (const row of rows) await emit(tx, restored, row, "account", now);
  });
}
/** 認可の前に、本人に復旧を選ばせる必要があるかを返す。値は復旧できる期限。 */
export async function pendingRecovery(
  deps: AccountLifecycleDeps,
  userId: string,
  service: string | null,
): Promise<{ account: Date | null; service: Date | null }> {
  const now = time(deps);
  const open = (deletedAt: Date | null) =>
    deletedAt && deadline(deletedAt) > now ? deadline(deletedAt) : null;
  const user = await deps.db.query.users.findFirst({
    columns: { status: true, deletedAt: true },
    where: eq(schema.users.id, userId),
  });
  const account = user?.status === "deleted" ? open(user.deletedAt) : null;
  if (!service || !(SERVICES as readonly string[]).includes(service))
    return { account, service: null };
  const row = await deps.db.query.serviceMemberships.findFirst({
    columns: { deletedAt: true, purgedAt: true },
    where: and(
      eq(schema.serviceMemberships.userId, userId),
      eq(schema.serviceMemberships.service, service),
    ),
  });
  return { account, service: row && !row.purgedAt ? open(row.deletedAt) : null };
}
export async function deleteServiceAccount(
  deps: AccountLifecycleDeps,
  userId: string,
  service: string,
  confirmation: string,
) {
  checkService(service);
  await deps.db.transaction(async (tx) => {
    const user = await lockOwner(tx, userId);
    requireActive(user);
    confirm(user, confirmation);
    await discoverServices(tx, userId);
    const row = await membership(tx, userId, service);
    if (row.deletedAt || row.purgedAt) fail("conflict", "service_already_deleted");
    const now = time(deps);
    const updated = { ...row, deletedAt: now };
    await tx
      .update(schema.serviceMemberships)
      .set({ deletedAt: now })
      .where(eq(schema.serviceMemberships.id, row.id));
    await revokeTokens(tx, userId, service);
    await emit(tx, user, updated, "service", now);
  });
}
export async function restoreServiceAccount(
  deps: AccountLifecycleDeps,
  userId: string,
  service: string,
) {
  checkService(service);
  await deps.db.transaction(async (tx) => {
    const user = await lockOwner(tx, userId);
    requireActive(user);
    const row = await membership(tx, userId, service);
    const now = time(deps);
    if (row.purgedAt || !row.deletedAt || deadline(row.deletedAt) <= now)
      fail("conflict", "service_not_recoverable");
    await tx
      .update(schema.serviceMemberships)
      .set({ deletedAt: null })
      .where(eq(schema.serviceMemberships.id, row.id));
    await emit(tx, user, { ...row, deletedAt: null }, "service", now);
  });
}
/**
 * 認可コードの交換で呼ぶ。期限内の退会は自動では戻さず拒む (本人が復旧を選ぶ)。
 * 期限を過ぎていれば旧データの削除を先に通知してから、新しく利用を始める。
 */
export async function visitService(deps: AccountLifecycleDeps, userId: string, service: string) {
  checkService(service);
  await deps.db.transaction(async (tx) => {
    const user = await lockOwner(tx, userId);
    requireActive(user);
    await tx.insert(schema.serviceMemberships).values({ userId, service }).onConflictDoNothing();
    let row = await membership(tx, userId, service);
    const now = time(deps);
    if (row.deletedAt && !row.purgedAt && deadline(row.deletedAt) > now)
      fail("forbidden", "service_deleted");
    if (row.deletedAt && deadline(row.deletedAt) <= now && !row.purgedAt) {
      row = await emit(tx, user, row, "service", now, true);
      row = { ...row, purgedAt: now };
    }
    if (row.deletedAt || row.purgedAt) {
      await tx
        .update(schema.serviceMemberships)
        .set({ deletedAt: null, purgedAt: null })
        .where(eq(schema.serviceMemberships.id, row.id));
      await emit(tx, user, { ...row, deletedAt: null, purgedAt: null }, "service", now);
    }
  });
}
/** 期限切れの対象を少数ずつ選び、各利用者をロックして期限と状態を読み直す。 */
export async function purgeAccounts(deps: AccountLifecycleDeps): Promise<number> {
  const now = time(deps);
  const before = new Date(now.getTime() - ACCOUNT_RECOVERY_MS);
  const globals = await deps.db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(
      and(
        eq(schema.users.status, "deleted"),
        ne(schema.users.role, "admin"),
        lte(schema.users.deletedAt, before),
      ),
    )
    .orderBy(asc(schema.users.id))
    .limit(200);
  const services = await deps.db
    .select({ id: schema.serviceMemberships.userId })
    .from(schema.serviceMemberships)
    .where(
      and(
        isNotNull(schema.serviceMemberships.deletedAt),
        isNull(schema.serviceMemberships.purgedAt),
        lte(schema.serviceMemberships.deletedAt, before),
      ),
    )
    .orderBy(asc(schema.serviceMemberships.userId))
    .limit(200);
  let purged = 0;
  for (const userId of new Set([...globals, ...services].map((r) => r.id))) {
    purged += await deps.db.transaction(async (tx) => {
      const [user] = await tx
        .select()
        .from(schema.users)
        .where(eq(schema.users.id, userId))
        .for("update");
      if (!user) return 0;
      const rows = await tx.query.serviceMemberships.findMany({
        where: eq(schema.serviceMemberships.userId, userId),
      });
      if (
        user.status === "deleted" &&
        user.deletedAt &&
        deadline(user.deletedAt) <= now &&
        user.role !== "admin"
      ) {
        for (const row of rows) await emit(tx, user, row, "account", now, true);
        await tx.delete(schema.users).where(eq(schema.users.id, userId));
        return 1;
      }
      for (const row of rows) {
        if (row.deletedAt && deadline(row.deletedAt) <= now && !row.purgedAt) {
          await tx
            .update(schema.serviceMemberships)
            .set({ purgedAt: now })
            .where(eq(schema.serviceMemberships.id, row.id));
          await emit(tx, user, row, "service", now, true);
        }
      }
      return 0;
    });
  }
  return purged;
}
