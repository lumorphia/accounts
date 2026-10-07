import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDatabase, schema } from "@lumorphia-accounts/db";
import { recordWorkerHeartbeat, readWorkerHealth, startWorkerHeartbeat } from "./worker-health.ts";

const url = process.env.DATABASE_URL;
describe.skipIf(!url)("worker health", () => {
  let database: ReturnType<typeof createDatabase>;
  const now = new Date("2026-10-07T06:00:00Z");
  beforeAll(() => {
    database = createDatabase(url!);
  });
  beforeEach(async () => {
    await database.db.delete(schema.workerHeartbeats);
  });
  afterAll(async () => {
    await database?.close();
  });
  it("marks a missing required worker as stale", async () => {
    expect(await readWorkerHealth(database.db, { accounts: true, characters: false }, now)).toEqual(
      { accounts: "stale", characters: "disabled" },
    );
  });
  it("reports a fresh enabled heartbeat as healthy", async () => {
    await recordWorkerHeartbeat(database.db, "accounts", true, now);
    expect(
      (await readWorkerHealth(database.db, { accounts: true, characters: false }, now)).accounts,
    ).toBe("ok");
  });
  it("marks a heartbeat at the two minute boundary as stale", async () => {
    await recordWorkerHeartbeat(database.db, "accounts", true, now);
    expect(
      (
        await readWorkerHealth(
          database.db,
          { accounts: true, characters: false },
          new Date(now.getTime() + 120_000),
        )
      ).accounts,
    ).toBe("stale");
  });
  it("does not count a disabled worker as an enabled consumer", async () => {
    await recordWorkerHeartbeat(database.db, "accounts", false, now);
    expect(
      (await readWorkerHealth(database.db, { accounts: true, characters: false }, now)).accounts,
    ).toBe("stale");
  });
  it("rejects a future heartbeat instead of extending its healthy period", async () => {
    await recordWorkerHeartbeat(database.db, "characters", true, new Date(now.getTime() + 1));
    expect(
      (await readWorkerHealth(database.db, { accounts: false, characters: true }, now)).characters,
    ).toBe("stale");
  });
  it("removes the heartbeat when the worker closes", async () => {
    const stop = await startWorkerHeartbeat(database.db, "accounts", true, () => undefined);
    try {
      expect(
        (await readWorkerHealth(database.db, { accounts: true, characters: false })).accounts,
      ).toBe("ok");
    } finally {
      await stop();
    }
    expect(
      (await readWorkerHealth(database.db, { accounts: true, characters: false })).accounts,
    ).toBe("stale");
  });
});
