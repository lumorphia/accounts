import { and, asc, eq, schema, type Database } from "@lumorphia-accounts/db";
import { DomainError } from "./errors.ts";
import { HANDLE_CHANGE_COOLDOWN_DAYS, validateHandle } from "./handle.ts";

export const NAME_MAX_LENGTH = 50;

export function normalizeName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed || trimmed.length > NAME_MAX_LENGTH)
    throw new DomainError("validation", `name must be 1..${NAME_MAX_LENGTH} characters`);
  return trimmed;
}

function assertHandle(handle: string): void {
  const valid = validateHandle(handle);
  if (!valid.ok) throw new DomainError("validation", `handle is ${valid.reason}`);
}

function isUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const value = error as { code?: string; cause?: { code?: string } };
  return value.code === "23505" || value.cause?.code === "23505";
}

export function handleLockedUntil(changedAt: Date | null): Date | null {
  return changedAt
    ? new Date(changedAt.getTime() + HANDLE_CHANGE_COOLDOWN_DAYS * 86_400_000)
    : null;
}

export async function handleAvailability(db: Database, handle: string, selfId: string | null) {
  const valid = validateHandle(handle);
  if (!valid.ok) return { available: false, reason: valid.reason } as const;
  const [owner] = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.handle, handle))
    .limit(1);
  return owner && owner.id !== selfId
    ? { available: false, reason: "taken" as const }
    : { available: true, reason: null };
}

export async function completeOnboarding(
  db: Database,
  userId: string,
  input: { handle: string; name: string },
  now = new Date(),
) {
  assertHandle(input.handle);
  const name = normalizeName(input.name);
  const user = await db.query.users.findFirst({
    columns: { status: true },
    where: eq(schema.users.id, userId),
  });
  if (!user) throw new DomainError("not_found", "user not found");
  if (user.status !== "pending") throw new DomainError("conflict", "account already set up");
  try {
    const rows = await db
      .update(schema.users)
      .set({ handle: input.handle, name, status: "active", handleChangedAt: now })
      .where(and(eq(schema.users.id, userId), eq(schema.users.status, "pending")))
      .returning({ id: schema.users.id });
    if (rows.length === 0) throw new DomainError("conflict", "account already set up");
  } catch (error) {
    if (isUniqueViolation(error)) throw new DomainError("conflict", "handle is taken");
    throw error;
  }
}

export async function getProfile(db: Database, userId: string) {
  const user = await db.query.users.findFirst({
    columns: { handle: true, name: true, image: true, handleChangedAt: true },
    where: eq(schema.users.id, userId),
  });
  if (!user) throw new DomainError("not_found", "user not found");
  return {
    handle: user.handle,
    name: user.name,
    image: user.image,
    nextHandleChangeAt: handleLockedUntil(user.handleChangedAt)?.toISOString() ?? null,
  };
}

export async function updateProfile(
  db: Database,
  userId: string,
  input: { name?: string | undefined; handle?: string | undefined },
  now = new Date(),
) {
  const user = await db.query.users.findFirst({
    columns: { handle: true, handleChangedAt: true, status: true },
    where: eq(schema.users.id, userId),
  });
  if (!user) throw new DomainError("not_found", "user not found");
  if (user.status !== "active") throw new DomainError("forbidden", "account not active");
  const patch: Partial<typeof schema.users.$inferInsert> = {};
  if (input.name !== undefined) patch.name = normalizeName(input.name);
  if (input.handle !== undefined && input.handle !== user.handle) {
    assertHandle(input.handle);
    const lockedUntil = handleLockedUntil(user.handleChangedAt);
    if (lockedUntil && lockedUntil > now)
      throw new DomainError("conflict", `handle is locked until ${lockedUntil.toISOString()}`);
    patch.handle = input.handle;
    patch.handleChangedAt = now;
  }
  if (Object.keys(patch).length) {
    try {
      await db.update(schema.users).set(patch).where(eq(schema.users.id, userId));
    } catch (error) {
      if (isUniqueViolation(error)) throw new DomainError("conflict", "handle is taken");
      throw error;
    }
  }
  return getProfile(db, userId);
}

export async function listLinkedAccounts(db: Database, userId: string) {
  const rows = await db
    .select({
      id: schema.accounts.id,
      providerId: schema.accounts.providerId,
      accountId: schema.accounts.accountId,
      displayName: schema.accounts.displayName,
      imageUrl: schema.accounts.imageUrl,
      createdAt: schema.accounts.createdAt,
    })
    .from(schema.accounts)
    .where(eq(schema.accounts.userId, userId))
    .orderBy(asc(schema.accounts.createdAt), asc(schema.accounts.id));
  const labels: Record<string, string> = { discord: "Discord", google: "Google", twitter: "X" };
  return rows.map((row) => ({
    id: row.id,
    providerId: row.providerId,
    label:
      row.providerId === "misskey" || row.providerId === "mastodon"
        ? row.accountId.slice(0, row.accountId.lastIndexOf(":"))
        : (labels[row.providerId] ?? row.providerId),
    displayName: row.displayName,
    imageUrl: row.imageUrl,
    createdAt: row.createdAt.toISOString(),
  }));
}

export async function unlinkAccount(
  db: Database,
  userId: string,
  accountId: string,
): Promise<void> {
  const own = await db
    .select({ id: schema.accounts.id })
    .from(schema.accounts)
    .where(eq(schema.accounts.userId, userId));
  if (!own.some((row) => row.id === accountId))
    throw new DomainError("not_found", "account not found");
  if (own.length <= 1) throw new DomainError("validation", "cannot unlink the last account");
  await db
    .delete(schema.accounts)
    .where(and(eq(schema.accounts.id, accountId), eq(schema.accounts.userId, userId)));
}
