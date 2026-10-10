import { randomUUID } from "node:crypto";
import { PgBoss } from "pg-boss";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDatabase, eq, schema, type Database } from "@lumorphia-accounts/db";
import { PgBossJobQueue, prepareCharacterQueues } from "./pg-boss.ts";
import { requestSync } from "../domain/characters.ts";
import { FakeLodestoneSource } from "../adapters/lodestone/index.ts";

const url = process.env.DATABASE_URL;
describe.skipIf(!url)("pg-boss character queue", () => {
  let db: Database;
  let close: () => Promise<void>;
  let boss: PgBoss;
  let queue: PgBossJobQueue;
  beforeAll(async () => {
    ({ db, close } = createDatabase(url!));
    boss = new PgBoss({
      connectionString: url!,
      schema: "pgboss",
      supervise: false,
      schedule: false,
    });
    boss.on("error", () => {});
    await boss.start();
    await prepareCharacterQueues(boss);
    queue = new PgBossJobQueue(boss);
  }, 30_000);
  beforeEach(async () => {
    await boss.deleteAllJobs();
    await db.delete(schema.users);
  });
  afterAll(async () => {
    await boss?.stop({ graceful: true, timeout: 1000 });
    await close?.();
  });
  it("persists a job in the character transaction", async () => {
    const id = randomUUID();
    await db.transaction(async (tx) => {
      await queue.enqueue(
        "character-sync",
        { characterId: id },
        { singletonKey: id, transaction: tx, retryLimit: 0 },
      );
    });
    const jobs = await boss.fetch<{ characterId: string }>("character-sync");
    expect(jobs.map((j) => j.data)).toEqual([{ characterId: id }]);
  });
  it("rolls back the queued job when its transaction fails", async () => {
    await expect(
      db.transaction(async (tx) => {
        await queue.enqueue("character-sync", { characterId: randomUUID() }, { transaction: tx });
        throw new Error("test-rollback");
      }),
    ).rejects.toThrow("test-rollback");
    expect(await boss.fetch("character-sync")).toEqual([]);
  });
  it("deduplicates a pending character job", async () => {
    const id = randomUUID();
    await queue.enqueue("character-sync", { characterId: id }, { singletonKey: id });
    await queue.enqueue("character-sync", { characterId: id }, { singletonKey: id });
    expect(await boss.findJobs("character-sync")).toHaveLength(1);
  });
  it("delays fanout jobs", async () => {
    await queue.enqueue(
      "character-sync",
      { characterId: randomUUID() },
      { startAfterSeconds: 60, retryLimit: 0 },
    );
    expect(await boss.fetch("character-sync")).toEqual([]);
    expect(await boss.findJobs("character-sync")).toHaveLength(1);
  });
  it("rolls back the manual cooldown when the queue insert fails", async () => {
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
    const [character] = await db
      .insert(schema.characters)
      .values({
        userId: user!.id,
        lodestoneId: "1001",
        name: "Test Character",
        world: "Tiamat",
        dataCenter: "Gaia",
        verifiedAt: new Date("2026-10-01T00:00:00Z"),
      })
      .returning();
    await boss.deleteQueue("character-sync");
    await expect(
      requestSync(
        { db, jobs: queue, lodestone: new FakeLodestoneSource(), enabled: true },
        user!.id,
        character!.id,
      ),
    ).rejects.toThrow();
    const [row] = await db
      .select()
      .from(schema.characters)
      .where(eq(schema.characters.id, character!.id));
    expect(row!.syncRequestedAt).toBeNull();
    await prepareCharacterQueues(boss);
    await requestSync(
      { db, jobs: queue, lodestone: new FakeLodestoneSource(), enabled: true },
      user!.id,
      character!.id,
    );
    expect(await boss.fetch("character-sync")).toHaveLength(1);
  });
});
