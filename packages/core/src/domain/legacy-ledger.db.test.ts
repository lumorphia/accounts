import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDatabase, eq, schema } from "@lumorphia-accounts/db";
import { completeOnboarding, handleAvailability, updateProfile } from "./users.ts";
import {
  importLegacyLedger,
  listLegacyPending,
  completeLegacyMigration,
  releaseLegacyAccount,
  type LegacyCharacter,
} from "./legacy-ledger.ts";
const url = process.env.DATABASE_URL;
describe.skipIf(!url)("legacy account ledger (PostgreSQL)", () => {
  let database: ReturnType<typeof createDatabase>;
  beforeAll(() => {
    database = createDatabase(url!);
  });
  beforeEach(async () => {
    await database.db.delete(schema.legacyAccounts);
    await database.db.delete(schema.legacyImports);
  });
  afterAll(async () => {
    await database?.close();
  });
  const record = (handle = `lg_${randomUUID().slice(0, 8)}`) => ({
    legacyUserId: randomUUID(),
    handle,
    identities: [{ providerId: "discord", accountId: `test-old-${randomUUID()}` }],
  });
  async function user(
    identity?: { providerId: string; accountId: string },
    status: "active" | "pending" = "active",
  ) {
    const stamp = randomUUID().slice(0, 8);
    const [row] = await database.db
      .insert(schema.users)
      .values({
        name: "Test",
        email: `test-legacy-${stamp}@example.invalid`,
        handle: `new_${stamp}`,
        status,
      })
      .returning();
    if (identity)
      await database.db.insert(schema.accounts).values({ userId: row!.id, ...identity });
    return row!;
  }
  it("imports a reordered snapshot idempotently without changing migration records", async () => {
    const a = record(),
      b = record();
    expect(
      await importLegacyLedger(database.db, { service: "prismtone", accounts: [a, b] }),
    ).toMatchObject({ imported: 2, repeated: false });
    const owner = await user(a.identities[0]);
    await completeLegacyMigration(database.db, owner.id, a.legacyUserId, "current");
    expect(
      await importLegacyLedger(database.db, { service: "prismtone", accounts: [b, a] }),
    ).toMatchObject({ imported: 2, repeated: true });
    expect(await listLegacyPending(database.db, owner.id)).toEqual([]);
  });
  it("rolls back an import with duplicate identities instead of leaving reservations", async () => {
    const a = record(),
      b = { ...record(), identities: a.identities };
    await expect(
      importLegacyLedger(database.db, { service: "prismtone", accounts: [a, b] }),
    ).rejects.toMatchObject({ code: "validation" });
    expect(await database.db.query.legacyAccounts.findMany()).toEqual([]);
  });
  it("refuses a different snapshot after the one time import", async () => {
    const a = record();
    await importLegacyLedger(database.db, { service: "prismtone", accounts: [a] });
    await expect(
      importLegacyLedger(database.db, { service: "prismtone", accounts: [a, record()] }),
    ).rejects.toMatchObject({ code: "conflict" });
  });
  it("opens a reserved handle only for its verified identity owner", async () => {
    const a = record();
    const owner = await user(a.identities[0]);
    const other = await user();
    await importLegacyLedger(database.db, { service: "prismtone", accounts: [a] });
    expect(await handleAvailability(database.db, a.handle, other.id)).toEqual({
      available: false,
      reason: "reserved",
    });
    expect(await handleAvailability(database.db, a.handle, owner.id)).toEqual({
      available: true,
      reason: null,
    });
    expect(await listLegacyPending(database.db, owner.id)).toEqual([
      { service: "prismtone", handle: a.handle },
    ]);
    expect(await listLegacyPending(database.db, other.id)).toEqual([]);
  });
  it("blocks onboarding into a reservation even without an availability request", async () => {
    const a = record();
    const other = await user(undefined, "pending");
    await importLegacyLedger(database.db, { service: "prismtone", accounts: [a] });
    await expect(
      completeOnboarding(database.db, other.id, {
        handle: a.handle,
        name: "Test",
        consent: { termsVersion: "1.0", privacyVersion: "1.0", ageConfirmed: true },
      }),
    ).rejects.toMatchObject({ code: "conflict" });
  });
  it("allows the matching pending user to select their old handle", async () => {
    const a = record();
    const owner = await user(a.identities[0], "pending");
    await importLegacyLedger(database.db, { service: "prismtone", accounts: [a] });
    await completeOnboarding(database.db, owner.id, {
      handle: a.handle,
      name: "Test",
      consent: { termsVersion: "1.0", privacyVersion: "1.0", ageConfirmed: true },
    });
    expect(
      (await database.db.query.users.findFirst({ where: eq(schema.users.id, owner.id) }))?.handle,
    ).toBe(a.handle);
  });
  it("blocks a profile update into someone else's reserved handle", async () => {
    const a = record();
    const other = await user();
    await importLegacyLedger(database.db, { service: "prismtone", accounts: [a] });
    await expect(updateProfile(database.db, other.id, { handle: a.handle })).rejects.toMatchObject({
      code: "conflict",
    });
  });
  it("rejects import when the old handle is occupied by an unrelated account", async () => {
    const other = await user();
    const a = record(other.handle);
    await expect(
      importLegacyLedger(database.db, { service: "prismtone", accounts: [a] }),
    ).rejects.toMatchObject({ code: "conflict" });
  });
  it("matches provider and exact host scoped identity together", async () => {
    const a = {
      ...record(),
      identities: [
        { providerId: "misskey", accountId: `misskey.example.invalid:test-${randomUUID()}` },
      ],
    };
    await importLegacyLedger(database.db, { service: "prismtone", accounts: [a] });
    const sameIdOtherProvider = await user({
      providerId: "mastodon",
      accountId: a.identities[0]!.accountId,
    });
    const sameProviderOtherHost = await user({
      providerId: "misskey",
      accountId: `another.example.invalid:${a.identities[0]!.accountId.split(":").at(-1)}`,
    });
    expect(await listLegacyPending(database.db, sameIdOtherProvider.id)).toEqual([]);
    expect(await listLegacyPending(database.db, sameProviderOtherHost.id)).toEqual([]);
  });
  it("requires a matching identity before completing another legacy account", async () => {
    const a = record();
    const other = await user();
    await importLegacyLedger(database.db, { service: "prismtone", accounts: [a] });
    await expect(
      completeLegacyMigration(database.db, other.id, a.legacyUserId, "legacy"),
    ).rejects.toMatchObject({ code: "forbidden" });
  });
  it("adopts the old handle once even during the normal handle cooldown", async () => {
    const a = record();
    const owner = await user(a.identities[0]);
    await database.db
      .update(schema.users)
      .set({ handleChangedAt: new Date() })
      .where(eq(schema.users.id, owner.id));
    await importLegacyLedger(database.db, { service: "prismtone", accounts: [a] });
    expect(
      await completeLegacyMigration(database.db, owner.id, a.legacyUserId, "legacy"),
    ).toMatchObject({ handle: a.handle, alreadyCompleted: false });
    expect(
      await completeLegacyMigration(database.db, owner.id, a.legacyUserId, "legacy"),
    ).toMatchObject({ alreadyCompleted: true });
    expect(await listLegacyPending(database.db, owner.id)).toEqual([]);
  });
  it("releases the old handle when the user explicitly keeps their current handle", async () => {
    const a = record();
    const owner = await user(a.identities[0]);
    const other = await user();
    await importLegacyLedger(database.db, { service: "prismtone", accounts: [a] });
    expect(
      await completeLegacyMigration(database.db, owner.id, a.legacyUserId, "current"),
    ).toMatchObject({ handle: owner.handle });
    expect(await handleAvailability(database.db, a.handle, other.id)).toEqual({
      available: true,
      reason: null,
    });
  });
  it("binds a legacy account to only one Lumorphia user under concurrent completion", async () => {
    const a = record();
    const second = { providerId: "google", accountId: `test-second-${randomUUID()}` };
    const owner = await user(a.identities[0]),
      other = await user(second);
    await importLegacyLedger(database.db, {
      service: "prismtone",
      accounts: [{ ...a, identities: [...a.identities, second] }],
    });
    const results = await Promise.allSettled([
      completeLegacyMigration(database.db, owner.id, a.legacyUserId, "current"),
      completeLegacyMigration(database.db, other.id, a.legacyUserId, "current"),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  });
  it("releases a permanently removed legacy account without resurrecting it on reimport", async () => {
    const a = record();
    const owner = await user(a.identities[0]);
    const snapshot = { service: "prismtone", accounts: [a] };
    await importLegacyLedger(database.db, snapshot);
    await releaseLegacyAccount(database.db, a.legacyUserId);
    await importLegacyLedger(database.db, snapshot);
    expect(await listLegacyPending(database.db, owner.id)).toEqual([]);
    expect(await handleAvailability(database.db, a.handle, owner.id)).toEqual({
      available: true,
      reason: null,
    });
  });
  it("previews a valid import without creating reservations or an import receipt", async () => {
    const a = record();
    expect(
      await importLegacyLedger(database.db, { service: "prismtone", accounts: [a] }, new Date(), {
        dryRun: true,
      }),
    ).toMatchObject({ imported: 1 });
    expect(await database.db.query.legacyAccounts.findMany()).toEqual([]);
    expect(await database.db.query.legacyImports.findMany()).toEqual([]);
  });
  it("does not bind two legacy accounts from the same service to one Lumorphia user", async () => {
    const a = record(),
      b = record();
    const owner = await user(a.identities[0]);
    await database.db.insert(schema.accounts).values({ userId: owner.id, ...b.identities[0]! });
    await importLegacyLedger(database.db, { service: "prismtone", accounts: [a, b] });
    await completeLegacyMigration(database.db, owner.id, a.legacyUserId, "current");
    await expect(
      completeLegacyMigration(database.db, owner.id, b.legacyUserId, "current"),
    ).rejects.toMatchObject({ code: "conflict" });
  });

  describe("characters on completion (ADR-0013)", () => {
    const lodestoneId = () => String(100_000_000 + Math.floor(Math.random() * 800_000_000));
    const character = (overrides: Partial<LegacyCharacter> = {}): LegacyCharacter => ({
      lodestoneId: lodestoneId(),
      name: "Test Character",
      world: "Tiamat",
      dataCenter: "Mana",
      race: null,
      clan: null,
      gender: null,
      avatarUrl: null,
      isPrimary: false,
      verifiedAt: null,
      ...overrides,
    });
    async function ready() {
      const a = record();
      await importLegacyLedger(database.db, { service: "prismtone", accounts: [a] });
      const owner = await user(a.identities[0]);
      return { a, owner };
    }
    const charactersOf = (userId: string) =>
      database.db.query.characters.findMany({ where: eq(schema.characters.userId, userId) });

    it("imports the old characters and keeps them verified", async () => {
      const { a, owner } = await ready();
      const verified = character({ verifiedAt: "2026-10-01T00:00:00.000Z", isPrimary: true });
      const plain = character();
      const result = await completeLegacyMigration(
        database.db,
        owner.id,
        a.legacyUserId,
        "current",
        new Date(),
        [verified, plain],
      );
      const rows = await charactersOf(owner.id);
      expect(rows).toHaveLength(2);
      expect(result.characters).toEqual(
        expect.arrayContaining([
          { lodestoneId: verified.lodestoneId, id: expect.any(String), verified: true },
          { lodestoneId: plain.lodestoneId, id: expect.any(String), verified: false },
        ]),
      );
      expect(rows.find((r) => r.lodestoneId === verified.lodestoneId)).toMatchObject({
        isPrimary: true,
        verifiedAt: new Date("2026-10-01T00:00:00.000Z"),
      });
    });

    it("imports a character verified by someone else as unverified", async () => {
      const { a, owner } = await ready();
      const other = await user();
      const shared = character({ verifiedAt: "2026-10-01T00:00:00.000Z" });
      await database.db.insert(schema.characters).values({
        userId: other.id,
        lodestoneId: shared.lodestoneId,
        name: "Test Other",
        world: "Tiamat",
        dataCenter: "Mana",
        verifiedAt: new Date(),
      });
      const result = await completeLegacyMigration(
        database.db,
        owner.id,
        a.legacyUserId,
        "current",
        new Date(),
        [shared],
      );
      expect(result.characters).toEqual([
        { lodestoneId: shared.lodestoneId, id: expect.any(String), verified: false },
      ]);
    });

    it("reuses a character the person already has in Lumorphia", async () => {
      const { a, owner } = await ready();
      const same = character();
      const [existing] = await database.db
        .insert(schema.characters)
        .values({
          userId: owner.id,
          lodestoneId: same.lodestoneId,
          name: "Test Existing",
          world: "Tiamat",
          dataCenter: "Mana",
        })
        .returning();
      const result = await completeLegacyMigration(
        database.db,
        owner.id,
        a.legacyUserId,
        "current",
        new Date(),
        [same],
      );
      expect(result.characters).toEqual([
        { lodestoneId: same.lodestoneId, id: existing!.id, verified: false },
      ]);
      expect(await charactersOf(owner.id)).toHaveLength(1);
    });

    it("keeps the person's primary character in Lumorphia", async () => {
      const { a, owner } = await ready();
      const [primary] = await database.db
        .insert(schema.characters)
        .values({
          userId: owner.id,
          lodestoneId: lodestoneId(),
          name: "Test Primary",
          world: "Tiamat",
          dataCenter: "Mana",
          isPrimary: true,
        })
        .returning();
      await completeLegacyMigration(database.db, owner.id, a.legacyUserId, "current", new Date(), [
        character({ isPrimary: true }),
      ]);
      const rows = await charactersOf(owner.id);
      expect(rows.filter((r) => r.isPrimary).map((r) => r.id)).toEqual([primary!.id]);
    });

    it("returns the same characters when the notice is sent again", async () => {
      const { a, owner } = await ready();
      const items = [character({ verifiedAt: "2026-10-01T00:00:00.000Z" }), character()];
      const first = await completeLegacyMigration(
        database.db,
        owner.id,
        a.legacyUserId,
        "current",
        new Date(),
        items,
      );
      const again = await completeLegacyMigration(
        database.db,
        owner.id,
        a.legacyUserId,
        "current",
        new Date(),
        items,
      );
      expect(again).toMatchObject({ alreadyCompleted: true });
      expect(again.characters).toEqual(expect.arrayContaining(first.characters));
      expect(await charactersOf(owner.id)).toHaveLength(2);
    });

    it("refuses more characters than one person can have", async () => {
      const { a, owner } = await ready();
      await expect(
        completeLegacyMigration(
          database.db,
          owner.id,
          a.legacyUserId,
          "current",
          new Date(),
          Array.from({ length: 41 }, () => character()),
        ),
      ).rejects.toMatchObject({ code: "validation" });
      expect(await charactersOf(owner.id)).toHaveLength(0);
    });
  });
});
