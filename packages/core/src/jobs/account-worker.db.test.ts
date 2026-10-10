import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MemoryStorage } from "@lumorphia/storage";
import { createDatabase, eq, schema } from "@lumorphia-accounts/db";
import { ACCOUNT_MAINTENANCE_QUEUE, startAccountWorker } from "./account-lifecycle.ts";
const url = process.env.DATABASE_URL;
describe.skipIf(!url)("account maintenance worker (PostgreSQL)", () => {
  let database: ReturnType<typeof createDatabase>;
  let worker: Awaited<ReturnType<typeof startAccountWorker>> | undefined;
  let userId: string;
  beforeAll(() => {
    database = createDatabase(url!);
  });
  afterAll(async () => {
    await worker?.stop();
    if (userId) await database.db.delete(schema.users).where(eq(schema.users.id, userId));
    await database?.close();
  });
  it("consumes durable cleanup and schedules maintenance in an isolated queue schema", async () => {
    const stamp = randomUUID().slice(0, 8);
    const [user] = await database.db
      .insert(schema.users)
      .values({
        name: "Test",
        email: `test-worker-${stamp}@example.invalid`,
        handle: `wk_${stamp}`,
        status: "deleted",
        deletedAt: new Date(Date.now() - 31 * 86_400_000),
      })
      .returning();
    userId = user!.id;
    worker = await startAccountWorker({
      connectionString: url!,
      queueSchema: `test_accounts_${stamp}`,
      enabled: true,
      deps: {
        db: database.db,
        storage: new MemoryStorage(),
        sign: async () => "test-token",
        fetch: async () => new Response(null, { status: 204 }),
      },
      log: { info: () => {}, error: () => {} },
    });
    await expect
      .poll(async () => database.db.query.users.findFirst({ where: eq(schema.users.id, userId) }), {
        timeout: 10_000,
      })
      .toBeUndefined();
    expect(await worker.boss.getSchedules()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: ACCOUNT_MAINTENANCE_QUEUE,
          cron: "* * * * *",
          timezone: "Asia/Tokyo",
        }),
      ]),
    );
  });
  it("keeps queued maintenance available without registering consumers when disabled", async () => {
    await worker?.stop();
    const stamp = randomUUID().slice(0, 8);
    worker = await startAccountWorker({
      connectionString: url!,
      queueSchema: `test_accounts_${stamp}`,
      enabled: false,
      deps: { db: database.db, storage: new MemoryStorage(), sign: async () => "test-token" },
      log: { info: () => {}, error: () => {} },
    });
    expect(await worker.boss.getSchedules()).toEqual([]);
    const id = await worker.boss.send(ACCOUNT_MAINTENANCE_QUEUE, { marker: "test-held" });
    expect(await worker.boss.fetch(ACCOUNT_MAINTENANCE_QUEUE)).toEqual(
      expect.arrayContaining([expect.objectContaining({ id, data: { marker: "test-held" } })]),
    );
  });
});
