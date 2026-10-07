import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { MemoryStorage } from "@lumorphia/storage";
import { createDatabase, eq, schema } from "@lumorphia-accounts/db";
import { setUploadedAvatar } from "./avatar.ts";
import { deleteLumorphiaAccount } from "./account-deletion.ts";
const url = process.env.DATABASE_URL;
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);
describe.skipIf(!url)("avatar retirement concurrency (PostgreSQL)", () => {
  it("captures an in flight avatar upload when deletion commits after it", async () => {
    const database = createDatabase(url!);
    const stamp = randomUUID().slice(0, 8);
    const [user] = await database.db
      .insert(schema.users)
      .values({
        name: "Test",
        email: `test-race-${stamp}@example.invalid`,
        handle: `ra_${stamp}`,
        status: "active",
      })
      .returning();
    const storage = new MemoryStorage();
    const put = storage.put.bind(storage);
    let started!: () => void;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const entered = new Promise<void>((resolve) => {
      started = resolve;
    });
    storage.put = async (input) => {
      started();
      await gate;
      await put(input);
    };
    try {
      const upload = setUploadedAvatar(
        { db: database.db, storage, imageBaseUrl: "https://img.example.invalid" },
        user!.id,
        png,
        "image/png",
      );
      await entered;
      const deleting = deleteLumorphiaAccount({ db: database.db }, user!.id, user!.handle);
      await Promise.race([deleting, new Promise((resolve) => setTimeout(resolve, 100))]);
      release();
      await Promise.all([upload, deleting]);
      expect(
        await database.db.query.users.findFirst({ where: eq(schema.users.id, user!.id) }),
      ).toMatchObject({ status: "deleted", image: null, avatarKeyBase: null });
      expect(
        await database.db.query.assetDeletions.findMany({
          where: eq(schema.assetDeletions.sub, user!.id),
        }),
      ).toHaveLength(1);
    } finally {
      release();
      await database.db.delete(schema.users).where(eq(schema.users.id, user!.id));
      await database.close();
    }
  });
});
