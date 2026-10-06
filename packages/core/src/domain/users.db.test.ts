import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, schema } from "@lumorphia-accounts/db";
import { completeOnboarding, getProfile, handleAvailability, updateProfile } from "./users.ts";

const url = process.env.DATABASE_URL;
const stamp = Math.random().toString(36).slice(2, 10);

describe.skipIf(!url)("user profiles", () => {
  let db: ReturnType<typeof createDatabase>["db"];
  let close: () => Promise<void>;
  let userId: string;
  let pendingId: string;
  beforeAll(async () => {
    ({ db, close } = createDatabase(url!));
    const [active, pending] = await db
      .insert(schema.users)
      .values([
        {
          name: "Test User",
          email: `test-active-${stamp}@example.invalid`,
          handle: `user_${stamp}`,
          status: "active",
          handleChangedAt: new Date(),
        },
        {
          name: "Pending",
          email: `test-pending-${stamp}@example.invalid`,
          handle: `pending_${stamp}`,
        },
      ])
      .returning({ id: schema.users.id });
    userId = active!.id;
    pendingId = pending!.id;
  });
  afterAll(async () => {
    await close?.();
  });

  it("reports invalid and reserved handles before querying availability", async () => {
    expect(await handleAvailability(db, "Ab", userId)).toEqual({
      available: false,
      reason: "invalid",
    });
    expect(await handleAvailability(db, "admin", userId)).toEqual({
      available: false,
      reason: "reserved",
    });
  });

  it("activates a pending user with their chosen handle and trimmed name", async () => {
    await completeOnboarding(db, pendingId, { handle: `new_${stamp}`, name: "  New User  " });
    expect(await getProfile(db, pendingId)).toMatchObject({
      handle: `new_${stamp}`,
      name: "New User",
    });
  });

  it("treats the user's own handle as available", async () => {
    expect(await handleAvailability(db, `user_${stamp}`, userId)).toEqual({
      available: true,
      reason: null,
    });
  });

  it("updates the display name while the handle is locked", async () => {
    const profile = await updateProfile(db, userId, { name: "  New Name  " });
    expect(profile.name).toBe("New Name");
  });

  it("rejects a handle change within 30 days", async () => {
    await expect(updateProfile(db, userId, { handle: `other_${stamp}` })).rejects.toMatchObject({
      code: "conflict",
    });
  });
});
