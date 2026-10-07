import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, eq, schema } from "@lumorphia-accounts/db";
import { completeOnboarding } from "./users.ts";

const url = process.env.DATABASE_URL;
describe.skipIf(!url)("onboarding legal consent", () => {
  let database: ReturnType<typeof createDatabase>;
  beforeAll(() => {
    database = createDatabase(url!);
  });
  afterAll(async () => {
    await database?.close();
  });
  const consent = { termsVersion: "1.0", privacyVersion: "1.0", ageConfirmed: true };
  async function pending() {
    const suffix = crypto.randomUUID().slice(0, 8);
    const [user] = await database.db
      .insert(schema.users)
      .values({ name: "Test", email: `test-${suffix}@example.invalid`, handle: `wait_${suffix}` })
      .returning();
    return user!;
  }
  for (const [label, value] of [
    ["missing consent", undefined],
    ["an outdated terms version", { ...consent, termsVersion: "0.9" }],
    ["an outdated privacy version", { ...consent, privacyVersion: "0.9" }],
    ["an unconfirmed age", { ...consent, ageConfirmed: false }],
  ] as const) {
    it(`rejects ${label} without activating the account`, async () => {
      const user = await pending();
      await expect(
        completeOnboarding(database.db, user.id, {
          handle: user.handle,
          name: "Test",
          consent: value,
        }),
      ).rejects.toMatchObject({ code: "validation" });
      expect(
        (await database.db.query.users.findFirst({ where: eq(schema.users.id, user.id) }))?.status,
      ).toBe("pending");
    });
  }
  it("records the accepted versions and server timestamp when activating the account", async () => {
    const user = await pending();
    const now = new Date("2026-10-07T06:00:00Z");
    await completeOnboarding(
      database.db,
      user.id,
      { handle: user.handle, name: "Test", consent },
      now,
    );
    expect(
      await database.db.query.users.findFirst({ where: eq(schema.users.id, user.id) }),
    ).toMatchObject({
      status: "active",
      termsVersion: "1.0",
      privacyVersion: "1.0",
      legalAcceptedAt: now,
    });
  });
});
