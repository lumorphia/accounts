import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MemoryStorage } from "@lumorphia/storage";
import { createDatabase, eq, schema } from "@lumorphia-accounts/db";
import { deleteLumorphiaAccount, restoreAccountForLogin } from "./account-deletion.ts";
import { deleteAccountAssets } from "../jobs/account-lifecycle.ts";
import { removeUploadedAvatar, setUploadedAvatar } from "./avatar.ts";

const url = process.env.DATABASE_URL;
const stamp = Math.random().toString(36).slice(2, 10);
const tinyPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

describe.skipIf(!url)("user avatar", () => {
  let db: ReturnType<typeof createDatabase>["db"];
  let close: () => Promise<void>;
  let userId: string;
  const storage = new MemoryStorage();
  beforeAll(async () => {
    ({ db, close } = createDatabase(url!));
    const [user] = await db
      .insert(schema.users)
      .values({
        name: "Test",
        email: `test-avatar-${stamp}@example.invalid`,
        handle: `av_${stamp}`,
        status: "active",
      })
      .returning({ id: schema.users.id });
    userId = user!.id;
  });
  afterAll(async () => {
    await close?.();
  });

  it("renders and stores the two avatar sizes", async () => {
    const result = await setUploadedAvatar(
      { db, storage, imageBaseUrl: "https://img.example.invalid" },
      userId,
      tinyPng,
      "image/png",
    );
    expect(result.image).toContain(`/avatars/${userId}/`);
    expect(await storage.list(`avatars/${userId}/`)).toHaveLength(2);
  });

  it("removes the uploaded avatar from the profile and storage", async () => {
    await removeUploadedAvatar(
      { db, storage, imageBaseUrl: "https://img.example.invalid" },
      userId,
    );
    const user = await db.query.users.findFirst({ where: eq(schema.users.id, userId) });
    expect(user?.image).toBeNull();
    expect(await storage.list(`avatars/${userId}/`)).toHaveLength(0);
  });
  it("keeps a new upload separate from pending deletion of the retired avatar", async () => {
    const deps = { db, storage, imageBaseUrl: "https://img.example.invalid" };
    const first = await setUploadedAvatar(deps, userId, tinyPng, "image/png");
    const user = await db.query.users.findFirst({ where: eq(schema.users.id, userId) });
    await deleteLumorphiaAccount({ db }, userId, user!.handle);
    await restoreAccountForLogin({ db }, userId);
    const second = await setUploadedAvatar(deps, userId, tinyPng, "image/png");
    expect(second.image).not.toBe(first.image);
    await deleteAccountAssets({ db, storage });
    const key = new URL(second.image).pathname.slice(1);
    expect(await storage.get(key)).not.toBeNull();
  });
});
