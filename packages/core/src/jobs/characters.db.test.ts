import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDatabase, eq, schema, sql, type Database } from "@lumorphia-accounts/db";
import { FakeLodestoneSource, fakeLodestoneCharacter } from "../adapters/lodestone/index.ts";
import { MemoryJobQueue } from "./queue.ts";
import { enqueueWeeklySyncs, runCharacterJob } from "./characters.ts";

const url = process.env.DATABASE_URL;
describe.skipIf(!url)("character jobs", () => {
  let db: Database;
  let close: () => Promise<void>;
  let userId: string;
  const now = new Date("2026-10-14T00:00:00Z");
  const old = new Date("2026-10-01T00:00:00Z");
  const source = new FakeLodestoneSource([fakeLodestoneCharacter({ lodestoneId: "1001" })]);
  beforeAll(async () => {
    ({ db, close } = createDatabase(url!));
  });
  beforeEach(async () => {
    await db.delete(schema.users);
    const stamp = randomUUID();
    const [user] = await db
      .insert(schema.users)
      .values({
        name: "Test User",
        email: `test-${stamp}@example.invalid`,
        handle: `test_${stamp}`,
        status: "active",
      })
      .returning();
    userId = user!.id;
    source.calls.length = 0;
  });
  afterAll(async () => {
    await close?.();
  });
  const add = async (values: Partial<typeof schema.characters.$inferInsert> = {}) => {
    const [row] = await db
      .insert(schema.characters)
      .values({
        userId,
        lodestoneId: "1001",
        name: "Test Character",
        world: "Tiamat",
        dataCenter: "Gaia",
        ...values,
      })
      .returning();
    return row!;
  };
  it("queues verified active characters whose sync is a week old", async () => {
    const c = await add({
      verifiedAt: old,
      lastSyncedAt: new Date(now.getTime() - 7 * 86_400_000),
    });
    const jobs = new MemoryJobQueue();
    expect(await enqueueWeeklySyncs({ db, jobs, enabled: true, now: () => now })).toBe(1);
    expect(jobs.jobs).toMatchObject([
      {
        name: "character-sync",
        data: { characterId: c.id },
        opts: { singletonKey: c.id, retryLimit: 0, startAfterSeconds: 0 },
      },
    ]);
  });
  it("does not queue unverified characters", async () => {
    await add();
    expect(
      await enqueueWeeklySyncs({ db, jobs: new MemoryJobQueue(), enabled: true, now: () => now }),
    ).toBe(0);
  });
  it("does not queue recently synced characters", async () => {
    await add({ verifiedAt: old, lastSyncedAt: now });
    expect(
      await enqueueWeeklySyncs({ db, jobs: new MemoryJobQueue(), enabled: true, now: () => now }),
    ).toBe(0);
  });
  it("does not queue suspended owners", async () => {
    await add({ verifiedAt: old, lastSyncedAt: old });
    await db.update(schema.users).set({ status: "suspended" }).where(eq(schema.users.id, userId));
    expect(
      await enqueueWeeklySyncs({ db, jobs: new MemoryJobQueue(), enabled: true, now: () => now }),
    ).toBe(0);
  });
  it("does not queue while Lodestone is disabled", async () => {
    await add({ verifiedAt: old, lastSyncedAt: old });
    expect(
      await enqueueWeeklySyncs({ db, jobs: new MemoryJobQueue(), enabled: false, now: () => now }),
    ).toBe(0);
  });
  it("fans out multiple pages without losing characters", async () => {
    await db.insert(schema.characters).values(
      Array.from({ length: 205 }, (_, i) => ({
        userId,
        lodestoneId: String(1000 + i),
        name: "Test Character",
        world: "Tiamat",
        dataCenter: "Gaia",
        verifiedAt: old,
        lastSyncedAt: old,
      })),
    );
    const jobs = new MemoryJobQueue();
    expect(await enqueueWeeklySyncs({ db, jobs, enabled: true, now: () => now })).toBe(205);
    expect(
      new Set(jobs.jobs.map((j) => (j.data as { characterId: string }).characterId)).size,
    ).toBe(205);
    expect(jobs.jobs[204]!.opts.startAfterSeconds).toBe(408);
  });
  it("runs verification from a queued id", async () => {
    const c = await add({
      verificationToken: "lumorphia-00000000",
      verificationExpiresAt: new Date(now.getTime() + 86_400_000),
    });
    source.setSelfIntroduction("1001", "lumorphia-00000000");
    expect(
      await runCharacterJob(
        "character-verify",
        { characterId: c.id },
        { db, jobs: new MemoryJobQueue(), lodestone: source, enabled: true, now: () => now },
      ),
    ).toBe("verified");
  });
  it("runs sync from a queued id", async () => {
    const c = await add({ verifiedAt: old, lastSyncedAt: old });
    expect(
      await runCharacterJob(
        "character-sync",
        { characterId: c.id },
        { db, jobs: new MemoryJobQueue(), lodestone: source, enabled: true, now: () => now },
      ),
    ).toBe("synced");
  });
  it("runs weekly fanout from a scheduled job", async () => {
    await add({ verifiedAt: old, lastSyncedAt: old });
    expect(
      await runCharacterJob(
        "character-sync-all",
        {},
        { db, jobs: new MemoryJobQueue(), lodestone: source, enabled: true, now: () => now },
      ),
    ).toBe(1);
  });
  it("rejects a malformed job before reading character data", async () => {
    await expect(
      runCharacterJob(
        "character-sync",
        { characterId: "test-invalid" },
        { db, jobs: new MemoryJobQueue(), lodestone: source, enabled: true },
      ),
    ).rejects.toThrow("invalid character job");
    expect(source.calls).toEqual([]);
  });
  it("skips a queued job for an inactive owner", async () => {
    const c = await add({ verifiedAt: old, lastSyncedAt: old });
    await db.update(schema.users).set({ status: "deleted" }).where(eq(schema.users.id, userId));
    expect(
      await runCharacterJob(
        "character-sync",
        { characterId: c.id },
        { db, jobs: new MemoryJobQueue(), lodestone: source, enabled: true },
      ),
    ).toBe("skipped");
    expect(source.calls).toEqual([]);
  });
  it("removes character data when the owner is physically deleted", async () => {
    await add({ verifiedAt: old });
    await db.delete(schema.users).where(eq(schema.users.id, userId));
    const result = await db.execute(sql`select count(*)::int as count from characters`);
    expect(result.rows[0]).toMatchObject({ count: 0 });
  });
});
