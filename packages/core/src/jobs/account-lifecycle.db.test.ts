import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MemoryStorage } from "@lumorphia/storage";
import { createDatabase, eq, schema } from "@lumorphia-accounts/db";
import {
  deliverAccountEvents,
  deleteAccountAssets,
  cleanupAccountReceipts,
} from "./account-lifecycle.ts";
const url = process.env.DATABASE_URL;
const now = new Date();
describe.skipIf(!url)("account outbox delivery (PostgreSQL)", () => {
  let database: ReturnType<typeof createDatabase>;
  beforeAll(() => {
    database = createDatabase(url!);
  });
  afterAll(async () => {
    await database?.close();
  });
  async function event(revision = 1, sub = randomUUID(), clientId = `test-${randomUUID()}`) {
    const [row] = await database.db
      .insert(schema.accountEvents)
      .values({
        sub,
        clientId,
        service: "scenote",
        endpoint: "https://scenote.lumorphia.test/api/lumorphia/account-events",
        revision,
        state: "deleted",
        scope: "account",
        occurredAt: now,
        deletedAt: now,
        recoverUntil: new Date(now.getTime() + 30 * 86_400_000),
        nextAttemptAt: now,
      })
      .returning();
    return row!;
  }
  const opts = (fetchFn: typeof fetch, current = now) => ({
    db: database.db,
    now: () => current,
    fetch: fetchFn,
    sign: async (row: typeof schema.accountEvents.$inferSelect) => `test-signed-${row.id}`,
  });
  it("marks an event delivered only after a successful receiver response", async () => {
    const row = await event();
    const called: string[] = [];
    await deliverAccountEvents(
      opts(async (input, init) => {
        called.push(String(input));
        expect(init?.redirect).toBe("error");
        expect(new URLSearchParams(String(init?.body)).get("event_token")).toBe(
          `test-signed-${row.id}`,
        );
        return new Response(null, { status: 204 });
      }),
    );
    expect(called).toContain(row.endpoint);
    expect(
      await database.db.query.accountEvents.findFirst({
        where: eq(schema.accountEvents.id, row.id),
      }),
    ).toMatchObject({ deliveredAt: now, attempts: 1, lastError: null });
  });
  it("retains a failed event and retries later with the same event id", async () => {
    const row = await event();
    await deliverAccountEvents(opts(async () => new Response(null, { status: 503 })));
    const failed = await database.db.query.accountEvents.findFirst({
      where: eq(schema.accountEvents.id, row.id),
    });
    expect(failed).toMatchObject({ deliveredAt: null, attempts: 1, lastError: "http_503" });
    expect(failed!.nextAttemptAt > now).toBe(true);
    await deliverAccountEvents(
      opts(async () => new Response(null, { status: 204 }), failed!.nextAttemptAt),
    );
    expect(
      await database.db.query.accountEvents.findFirst({
        where: eq(schema.accountEvents.id, row.id),
      }),
    ).toMatchObject({ deliveredAt: failed!.nextAttemptAt, attempts: 2 });
  });
  it("keeps restoration behind the preceding deletion until it is acknowledged", async () => {
    const sub = randomUUID();
    const clientId = `test-${randomUUID()}`;
    const first = await event(1, sub, clientId);
    const second = await event(2, sub, clientId);
    await database.db
      .update(schema.accountEvents)
      .set({ state: "active", deletedAt: null, recoverUntil: null })
      .where(eq(schema.accountEvents.id, second.id));
    const tokens: string[] = [];
    await deliverAccountEvents(
      opts(async (_input, init) => {
        tokens.push(new URLSearchParams(String(init?.body)).get("event_token")!);
        return new Response(null, { status: 503 });
      }),
    );
    expect(tokens).toContain(`test-signed-${first.id}`);
    expect(tokens).not.toContain(`test-signed-${second.id}`);
  });
  it("does not deliver the same event concurrently from two workers", async () => {
    const row = await event();
    let count = 0;
    const fetchFn = async (_input: unknown, init?: RequestInit) => {
      if (String(init?.body).includes(row.id)) count++;
      await new Promise((r) => setTimeout(r, 10));
      return new Response(null, { status: 204 });
    };
    await Promise.all([deliverAccountEvents(opts(fetchFn)), deliverAccountEvents(opts(fetchFn))]);
    expect(count).toBe(1);
  });
  it("keeps network and signing failures retryable without logging token contents", async () => {
    const row = await event();
    await deliverAccountEvents({
      ...opts(async () => {
        throw new Error("test-secret-network-message");
      }),
      sign: async () => {
        throw new Error("test-secret-signing-message");
      },
    });
    expect(
      await database.db.query.accountEvents.findFirst({
        where: eq(schema.accountEvents.id, row.id),
      }),
    ).toMatchObject({ deliveredAt: null, lastError: "delivery_failed" });
  });
  it("deletes uploaded variants even after their owner has been physically removed", async () => {
    const storage = new MemoryStorage();
    const base = `avatars/${randomUUID()}/0000000000000000`;
    for (const size of [64, 256])
      await storage.put({
        key: `${base}/${size}.webp`,
        body: new Uint8Array([1]),
        contentType: "image/webp",
      });
    const [row] = await database.db
      .insert(schema.assetDeletions)
      .values({ sub: randomUUID(), keyBase: base, nextAttemptAt: now })
      .returning();
    await deleteAccountAssets({ db: database.db, storage, now: () => now });
    expect(await storage.get(`${base}/64.webp`)).toBeNull();
    expect(
      await database.db.query.assetDeletions.findFirst({
        where: eq(schema.assetDeletions.id, row!.id),
      }),
    ).toMatchObject({ deletedAt: now, attempts: 1 });
  });
  it("keeps failed image cleanup queued for retry", async () => {
    const [row] = await database.db
      .insert(schema.assetDeletions)
      .values({
        sub: randomUUID(),
        keyBase: `avatars/${randomUUID()}/0000000000000000`,
        nextAttemptAt: now,
      })
      .returning();
    const storage = new MemoryStorage();
    storage.delete = async () => {
      throw new Error("test-storage-failure");
    };
    await deleteAccountAssets({ db: database.db, storage, now: () => now });
    expect(
      await database.db.query.assetDeletions.findFirst({
        where: eq(schema.assetDeletions.id, row!.id),
      }),
    ).toMatchObject({ deletedAt: null, attempts: 1, lastError: "storage_failed" });
  });
  it("removes completed receipts after thirty days while retaining pending delivery", async () => {
    const done = await event();
    const pending = await event();
    await database.db
      .update(schema.accountEvents)
      .set({ deliveredAt: new Date(now.getTime() - 31 * 86_400_000) })
      .where(eq(schema.accountEvents.id, done.id));
    await cleanupAccountReceipts({ db: database.db, now: () => now });
    expect(
      await database.db.query.accountEvents.findFirst({
        where: eq(schema.accountEvents.id, done.id),
      }),
    ).toBeUndefined();
    expect(
      await database.db.query.accountEvents.findFirst({
        where: eq(schema.accountEvents.id, pending.id),
      }),
    ).toBeDefined();
  });
});
