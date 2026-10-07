import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, eq, schema } from "@lumorphia-accounts/db";
import {
  deleteLumorphiaAccount,
  deleteServiceAccount,
  restoreAccountForLogin,
  restoreServiceAccount,
  visitService,
  purgeAccounts,
  listServices,
} from "./account-deletion.ts";
const databaseUrl = process.env.DATABASE_URL;
const now = new Date("2026-10-07T00:00:00Z");
const day = 86_400_000;
describe.skipIf(!databaseUrl)("account lifecycle (PostgreSQL)", () => {
  let database: ReturnType<typeof createDatabase>;
  beforeAll(() => {
    database = createDatabase(databaseUrl!);
  });
  afterAll(async () => {
    await database?.close();
  });
  const deps = (time = now) => ({ db: database.db, now: () => time });
  async function setup(
    status: "active" | "pending" | "suspended" = "active",
    role: "user" | "admin" = "user",
  ) {
    const stamp = randomUUID().slice(0, 8);
    const [user] = await database.db
      .insert(schema.users)
      .values({
        name: "Test User",
        email: `test-${stamp}@example.invalid`,
        handle: `del_${stamp}`,
        status,
        role,
        image: "https://images.example.invalid/test.webp",
        avatarKeyBase: `avatars/${randomUUID()}/0000000000000000`,
      })
      .returning();
    for (const service of ["prismtone", "scenote"] as const)
      await database.db.insert(schema.oauthClients).values({
        clientId: `test-${stamp}-${service}`,
        name: service,
        redirectUris: [`https://${service}.lumorphia.test/callback`],
        metadata: {
          lumorphia_service: service,
          lifecycle_uri: `https://${service}.lumorphia.test/api/lumorphia/account-events`,
        },
      });
    await database.db.insert(schema.accounts).values({
      userId: user!.id,
      providerId: "discord",
      accountId: `test-${stamp}`,
      imageUrl: "https://images.example.invalid/test.webp",
    });
    await database.db.insert(schema.sessions).values({
      userId: user!.id,
      token: `test-${stamp}`,
      expiresAt: new Date(now.getTime() + day),
    });
    await visitService(deps(), user!.id, "prismtone");
    await visitService(deps(), user!.id, "scenote");
    return user!;
  }
  const userRow = (id: string) =>
    database.db.query.users.findFirst({ where: eq(schema.users.id, id) });
  const events = (id: string) =>
    database.db.query.accountEvents.findMany({
      where: eq(schema.accountEvents.sub, id),
      orderBy: (t, { asc }) => [asc(t.createdAt), asc(t.id)],
    });
  it("deletes sessions and hides the global account while retaining recoverable identities", async () => {
    const user = await setup();
    await deleteLumorphiaAccount(deps(), user.id, user.handle);
    expect(await userRow(user.id)).toMatchObject({
      status: "deleted",
      deletedAt: now,
      image: null,
      avatarKeyBase: null,
    });
    expect(
      await database.db.query.sessions.findMany({ where: eq(schema.sessions.userId, user.id) }),
    ).toEqual([]);
    expect(
      await database.db.query.accounts.findMany({ where: eq(schema.accounts.userId, user.id) }),
    ).toHaveLength(1);
    expect(
      (await events(user.id)).every((e) => e.state === "deleted" && e.scope === "account"),
    ).toBe(true);
    expect(new Set((await events(user.id)).map((e) => e.service))).toEqual(
      new Set(["prismtone", "scenote"]),
    );
    expect(
      await database.db.query.assetDeletions.findMany({
        where: eq(schema.assetDeletions.sub, user.id),
      }),
    ).toHaveLength(1);
  });
  it("rejects a mismatched confirmation without changing the account", async () => {
    const user = await setup();
    await expect(deleteLumorphiaAccount(deps(), user.id, "other")).rejects.toMatchObject({
      code: "validation",
    });
    expect((await userRow(user.id))?.status).toBe("active");
    expect(await events(user.id)).toEqual([]);
  });
  it("preserves administrator accounts", async () => {
    const user = await setup("active", "admin");
    await expect(deleteLumorphiaAccount(deps(), user.id, user.handle)).rejects.toMatchObject({
      code: "forbidden",
    });
  });
  it("restores a global account strictly before the deadline without restoring images", async () => {
    const user = await setup();
    await deleteLumorphiaAccount(deps(), user.id, user.handle);
    expect(
      await restoreAccountForLogin(deps(new Date(now.getTime() + 30 * day - 1)), user.id),
    ).toBe(true);
    expect(await userRow(user.id)).toMatchObject({
      status: "active",
      deletedAt: null,
      image: null,
    });
    expect((await events(user.id)).filter((e) => e.state === "active").length).toBeGreaterThan(0);
  });
  it("rejects login at the recovery deadline", async () => {
    const user = await setup();
    await deleteLumorphiaAccount(deps(), user.id, user.handle);
    await expect(
      restoreAccountForLogin(deps(new Date(now.getTime() + 30 * day)), user.id),
    ).rejects.toMatchObject({ code: "forbidden", message: "recovery_expired" });
    expect((await userRow(user.id))?.status).toBe("deleted");
  });
  it("does not issue duplicate events for simultaneous global deletion", async () => {
    const user = await setup();
    const outcomes = await Promise.allSettled([
      deleteLumorphiaAccount(deps(), user.id, user.handle),
      deleteLumorphiaAccount(deps(), user.id, user.handle),
    ]);
    expect(outcomes.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rows = await events(user.id);
    expect(rows.every((e) => e.revision === 1)).toBe(true);
  });
  it("restores exactly once under concurrent logins", async () => {
    const user = await setup();
    await deleteLumorphiaAccount(deps(), user.id, user.handle);
    expect(
      (
        await Promise.all([
          restoreAccountForLogin(deps(), user.id),
          restoreAccountForLogin(deps(), user.id),
        ])
      ).filter(Boolean),
    ).toHaveLength(1);
    expect((await events(user.id)).every((e) => e.revision <= 2)).toBe(true);
  });
  it("deletes only one service without altering global sessions or characters", async () => {
    const user = await setup();
    await deleteServiceAccount(deps(), user.id, "prismtone", user.handle);
    expect((await userRow(user.id))?.status).toBe("active");
    expect(
      await database.db.query.sessions.findMany({ where: eq(schema.sessions.userId, user.id) }),
    ).toHaveLength(1);
    expect((await listServices(deps(), user.id)).find((s) => s.service === "scenote")?.state).toBe(
      "active",
    );
    expect(
      (await events(user.id)).every((e) => e.service === "prismtone" && e.scope === "service"),
    ).toBe(true);
  });
  it("restores a service on its next login within thirty days", async () => {
    const user = await setup();
    await deleteServiceAccount(deps(), user.id, "prismtone", user.handle);
    await visitService(deps(), user.id, "prismtone");
    expect(
      (await listServices(deps(), user.id)).find((s) => s.service === "prismtone")?.state,
    ).toBe("active");
  });
  it("retains independent service deletion after global recovery", async () => {
    const user = await setup();
    await deleteServiceAccount(deps(), user.id, "prismtone", user.handle);
    await deleteLumorphiaAccount(deps(), user.id, user.handle);
    await restoreAccountForLogin(deps(), user.id);
    const services = await listServices(deps(), user.id);
    expect(services.find((s) => s.service === "prismtone")?.state).toBe("deleted");
    expect(services.find((s) => s.service === "scenote")?.state).toBe("active");
  });
  it("purges expired global accounts including identities and characters but keeps pending events", async () => {
    const user = await setup();
    await database.db.insert(schema.characters).values({
      userId: user.id,
      lodestoneId: "15022394",
      name: "Hal Myth",
      world: "Tiamat",
      dataCenter: "Gaia",
    });
    await deleteLumorphiaAccount(deps(), user.id, user.handle);
    await purgeAccounts(deps(new Date(now.getTime() + 30 * day)));
    expect(await userRow(user.id)).toBeUndefined();
    expect(
      await database.db.query.accounts.findMany({ where: eq(schema.accounts.userId, user.id) }),
    ).toEqual([]);
    expect(
      await database.db.query.characters.findMany({ where: eq(schema.characters.userId, user.id) }),
    ).toEqual([]);
    expect((await events(user.id)).some((e) => e.state === "purged")).toBe(true);
    expect(
      await database.db.query.assetDeletions.findMany({
        where: eq(schema.assetDeletions.sub, user.id),
      }),
    ).toHaveLength(1);
  });
  it("does not purge global accounts before their recovery deadline", async () => {
    const user = await setup();
    await deleteLumorphiaAccount(deps(), user.id, user.handle);
    await purgeAccounts(deps(new Date(now.getTime() + 30 * day - 1)));
    expect(await userRow(user.id)).toBeDefined();
  });
  it("purges an expired service while retaining the Lumorphia account", async () => {
    const user = await setup();
    await deleteServiceAccount(deps(), user.id, "prismtone", user.handle);
    await purgeAccounts(deps(new Date(now.getTime() + 30 * day)));
    expect((await userRow(user.id))?.status).toBe("active");
    expect(
      (await listServices(deps(), user.id)).find((s) => s.service === "prismtone")?.state,
    ).toBe("purged");
    await expect(
      restoreServiceAccount(deps(new Date(now.getTime() + 30 * day)), user.id, "prismtone"),
    ).rejects.toMatchObject({ code: "conflict" });
  });
  it("starts a new service membership after its previous data was purged", async () => {
    const user = await setup();
    await deleteServiceAccount(deps(), user.id, "prismtone", user.handle);
    await visitService(deps(new Date(now.getTime() + 31 * day)), user.id, "prismtone");
    expect(
      (await listServices(deps(), user.id)).find((s) => s.service === "prismtone")?.state,
    ).toBe("active");
    const rows = (await events(user.id)).filter(
      (e) => e.service === "prismtone" && e.clientId === `test-${user.handle.slice(4)}-prismtone`,
    );
    expect(rows.slice(-2).map((e) => e.state)).toEqual(["purged", "active"]);
  });
});
