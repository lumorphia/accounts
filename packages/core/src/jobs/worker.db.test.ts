import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, eq, schema, type Database } from "@lumorphia-accounts/db";
import { FakeLodestoneSource, fakeLodestoneCharacter } from "../adapters/lodestone/index.ts";
import { requestSync } from "../domain/characters.ts";
import { startCharacterWorker } from "./pg-boss.ts";

const url = process.env.DATABASE_URL;
describe.skipIf(!url)("character worker lifecycle", () => {
  let db: Database;
  let close: () => Promise<void>;
  let worker: Awaited<ReturnType<typeof startCharacterWorker>>;
  let characterId: string;
  let userId: string;
  const lodestoneId = String(10_000_000_000 + Math.floor(Math.random() * 80_000_000_000));
  const lodestone = new FakeLodestoneSource([
    fakeLodestoneCharacter({ lodestoneId, selfIntroduction: "lumorphia-00000000" }),
  ]);
  const events: object[] = [];
  beforeAll(async () => {
    ({ db, close } = createDatabase(url!));
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
    const [character] = await db
      .insert(schema.characters)
      .values({
        userId,
        lodestoneId,
        name: "Test Character",
        world: "Tiamat",
        dataCenter: "Gaia",
        verificationToken: "lumorphia-00000000",
        verificationExpiresAt: new Date(Date.now() + 86_400_000),
      })
      .returning();
    characterId = character!.id;
    // テスト専用スキーマを毎回作る。既存の pg-boss ジョブを消さない
    worker = await startCharacterWorker({
      connectionString: url!,
      queueSchema: `test_jobs_${randomUUID().slice(0, 8)}`,
      db,
      lodestone,
      enabled: true,
      log: { info: (fields) => events.push(fields), error: (fields) => events.push(fields) },
    });
  }, 30_000);
  afterAll(async () => {
    await worker?.stop();
    if (userId) await db.delete(schema.users).where(eq(schema.users.id, userId));
    await close?.();
  });
  it("delivers verification and a manual sync through the running worker", async () => {
    await worker.queue.enqueue("character-verify", { characterId }, { singletonKey: characterId });
    await expect
      .poll(
        async () =>
          (await db.query.characters.findFirst({ where: eq(schema.characters.id, characterId) }))
            ?.verifiedAt,
        { timeout: 10_000 },
      )
      .not.toBeNull();
    await db
      .update(schema.characters)
      .set({ lastSyncedAt: new Date(Date.now() - 2 * 86_400_000) })
      .where(eq(schema.characters.id, characterId));
    lodestone.add(fakeLodestoneCharacter({ lodestoneId, name: "Test Renamed" }));
    await requestSync({ db, lodestone, jobs: worker.queue, enabled: true }, userId, characterId);
    await expect
      .poll(
        async () =>
          (await db.query.characters.findFirst({ where: eq(schema.characters.id, characterId) }))
            ?.name,
        { timeout: 10_000 },
      )
      .toBe("Test Renamed");
    expect(events).toContainEqual(
      expect.objectContaining({ jobName: "character-verify", result: "verified" }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({ jobName: "character-sync", result: "synced" }),
    );
    expect(JSON.stringify(events)).not.toContain("lumorphia-00000000");
  }, 15_000);
  it("registers the weekly schedule in Japanese time", async () => {
    expect(await worker.boss.getSchedules("character-sync-all")).toContainEqual(
      expect.objectContaining({ cron: "0 4 * * 1", timezone: "Asia/Tokyo" }),
    );
  });
  it("records an invalid queued job as failed", async () => {
    const id = await worker.boss.send("character-sync", { characterId: "test-invalid" });
    await expect
      .poll(
        async () =>
          (await worker.boss.findJobs("character-sync")).find((job) => job.id === id)?.state,
        { timeout: 10_000 },
      )
      .toBe("failed");
    expect(events).toContainEqual(
      expect.objectContaining({ jobName: "character-sync", jobId: id }),
    );
  });
  it("keeps queued requests pending while fetching is disabled", async () => {
    const disabled = await startCharacterWorker({
      connectionString: url!,
      queueSchema: `test_jobs_${randomUUID().slice(0, 8)}`,
      db,
      lodestone,
      enabled: false,
      log: { info: () => {}, error: () => {} },
    });
    try {
      await disabled.queue.enqueue("character-sync", { characterId });
      expect(disabled.boss.getWipData()).toEqual([]);
      expect(await disabled.boss.getSchedules()).toEqual([]);
      expect(await disabled.boss.findJobs("character-sync")).toMatchObject([{ state: "created" }]);
    } finally {
      await disabled.stop();
    }
  });
});
