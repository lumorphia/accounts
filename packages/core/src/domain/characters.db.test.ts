import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDatabase, eq, schema, type Database } from "@lumorphia-accounts/db";
import {
  FakeLodestoneSource,
  fakeLodestoneCharacter,
  LodestoneError,
} from "../adapters/lodestone/index.ts";
import { MemoryJobQueue } from "../jobs/queue.ts";
import {
  checkVerification,
  deleteCharacter,
  listCharacters,
  registerCharacter,
  reissueToken,
  requestSync,
  setPrimaryCharacter,
  syncCharacter,
  verifyCharacter,
  type CharacterDeps,
} from "./characters.ts";

const url = process.env.DATABASE_URL;
describe.skipIf(!url)("characters (PostgreSQL)", () => {
  let db: Database;
  let close: () => Promise<void>;
  let alice: string;
  let bob: string;
  let lodestone: FakeLodestoneSource;
  let jobs: MemoryJobQueue;
  let deps: CharacterDeps;
  let now: Date;
  const user = async () => {
    const stamp = randomUUID();
    const [row] = await db
      .insert(schema.users)
      .values({
        name: "Test User",
        email: `test-${stamp}@example.invalid`,
        handle: `test_${stamp}`,
        status: "active",
      })
      .returning();
    return row!.id;
  };
  const register = (userId = alice, id = "1001") =>
    registerCharacter(deps, userId, { lodestone: id });
  const verified = async () => {
    const c = await register();
    lodestone.setSelfIntroduction("1001", c.verification!.token);
    await checkVerification(deps, alice, c.id);
    return c;
  };
  beforeAll(async () => {
    ({ db, close } = createDatabase(url!));
  });
  beforeEach(async () => {
    // ファイル専用の DB。前回の確認済みキャラクターも残さない
    await db.delete(schema.users);
    alice = await user();
    bob = await user();
    now = new Date("2026-10-07T00:00:00Z");
    lodestone = new FakeLodestoneSource(
      Array.from({ length: 42 }, (_, i) =>
        fakeLodestoneCharacter({ lodestoneId: String(1001 + i), name: `Test Character ${i}` }),
      ),
    );
    jobs = new MemoryJobQueue();
    deps = { db, lodestone, jobs, enabled: true, now: () => now };
  });
  afterAll(async () => {
    await close?.();
  });

  it("registers an unverified primary character with a 24-hour token", async () => {
    const c = await register();
    expect(c).toMatchObject({
      lodestoneId: "1001",
      isPrimary: true,
      verified: false,
      name: "Test Character 0",
    });
    expect(c.verification!.token).toMatch(/^lumorphia-[0-9a-f]{8}$/);
    expect(c.verification!.expiresAt).toBe("2026-10-08T00:00:00.000Z");
  });
  it("registers one exact search match", async () => {
    expect(
      await registerCharacter(deps, alice, { name: " test character 1 ", world: "Tiamat" }),
    ).toMatchObject({ lodestoneId: "1002" });
  });
  it("rejects a search with no exact match", async () => {
    await expect(
      registerCharacter(deps, alice, { name: "Test Missing", world: "Tiamat" }),
    ).rejects.toMatchObject({ message: "character_not_found" });
  });
  it("rejects an ambiguous search", async () => {
    lodestone.add(fakeLodestoneCharacter({ lodestoneId: "2001", name: "Test Character 0" }));
    await expect(
      registerCharacter(deps, alice, { name: "Test Character 0", world: "Tiamat" }),
    ).rejects.toMatchObject({ message: "ambiguous_character" });
  });
  it("maps a missing Lodestone page", async () => {
    await expect(register(alice, "9999")).rejects.toMatchObject({
      code: "not_found",
      message: "lodestone_character_not_found",
    });
  });
  it("maps an upstream outage", async () => {
    lodestone.failNextWith = new LodestoneError("unavailable");
    await expect(register()).rejects.toMatchObject({ code: "upstream_unavailable" });
  });
  it("rejects a duplicate registration", async () => {
    await register();
    await expect(register()).rejects.toMatchObject({
      code: "conflict",
      message: "already_registered",
    });
  });
  it("allows two people to register the same unverified id", async () => {
    await register();
    expect(await register(bob)).toMatchObject({ verified: false });
  });
  it("serializes concurrent first registrations", async () => {
    await Promise.all([register(), register(alice, "1002")]);
    expect((await listCharacters(db, alice)).filter((c) => c.isPrimary)).toHaveLength(1);
  });
  it("rejects one concurrent duplicate registration", async () => {
    const results = await Promise.allSettled([register(), register()]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.find((r) => r.status === "rejected")).toMatchObject({
      reason: { message: "already_registered" },
    });
  });
  it("enforces the 40-character limit under concurrent registrations", async () => {
    await db.insert(schema.characters).values(
      Array.from({ length: 39 }, (_, i) => ({
        userId: alice,
        lodestoneId: String(5000 + i),
        name: "Test Character",
        world: "Tiamat",
        dataCenter: "Gaia",
        isPrimary: i === 0,
      })),
    );
    const results = await Promise.allSettled([register(), register(alice, "1002")]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.find((r) => r.status === "rejected")).toMatchObject({
      reason: { message: "too_many_characters" },
    });
    expect(await listCharacters(db, alice)).toHaveLength(40);
  });
  it("does not fetch when Lodestone is disabled", async () => {
    await expect(
      registerCharacter({ ...deps, enabled: false }, alice, { lodestone: "1001" }),
    ).rejects.toMatchObject({ message: "lodestone_disabled" });
    expect(lodestone.calls).toEqual([]);
  });
  it("rejects registration for an inactive owner", async () => {
    await db.update(schema.users).set({ status: "suspended" }).where(eq(schema.users.id, alice));
    await expect(register()).rejects.toMatchObject({ code: "forbidden" });
  });
  it("records a missing verification token", async () => {
    const c = await register();
    const result = await checkVerification(deps, alice, c.id);
    expect(result).toMatchObject({
      result: "token_not_found",
      character: { verificationError: "token_not_found", verificationCheckedAt: now.toISOString() },
    });
  });
  it("verifies the token and discards it without storing the introduction", async () => {
    const c = await verified();
    const [row] = await db.select().from(schema.characters).where(eq(schema.characters.id, c.id));
    expect(row).toMatchObject({
      verifiedAt: now,
      verificationToken: null,
      verificationExpiresAt: null,
      lastSyncedAt: now,
    });
    expect(row).not.toHaveProperty("selfIntroduction");
  });
  it("does not match a token embedded in a longer token", async () => {
    const c = await register();
    lodestone.setSelfIntroduction("1001", `${c.verification!.token}a`);
    expect(await verifyCharacter(deps, c.id)).toBe("token_not_found");
  });
  it("expires the token at exactly 24 hours", async () => {
    const c = await register();
    now = new Date(now.getTime() + 86_400_000);
    expect((await listCharacters(db, alice, now))[0]!.verification).toBeNull();
    await expect(checkVerification(deps, alice, c.id)).rejects.toMatchObject({
      message: "token_expired",
    });
  });
  it("reissues an expired token and clears the previous error", async () => {
    const c = await register();
    now = new Date(now.getTime() + 86_400_000);
    expect(await verifyCharacter(deps, c.id)).toBe("token_expired");
    const replacement = await reissueToken(deps, alice, c.id);
    expect(replacement.verification!.token).not.toBe(c.verification!.token);
    expect(replacement.verificationError).toBeNull();
  });
  it("rejects token reissue for a verified character", async () => {
    const c = await verified();
    await expect(reissueToken(deps, alice, c.id)).rejects.toMatchObject({
      message: "already_verified",
    });
  });
  it("records an upstream verification error", async () => {
    const c = await register();
    lodestone.failNextWith = new LodestoneError("parse_error");
    expect(await verifyCharacter(deps, c.id)).toBe("lodestone_error");
    expect((await listCharacters(db, alice))[0]!.verified).toBe(false);
  });
  it("allows only one concurrent verified owner of a Lodestone id", async () => {
    const a = await register();
    const b = await register(bob);
    lodestone.setSelfIntroduction("1001", `${a.verification!.token}\n${b.verification!.token}`);
    const results = await Promise.all([verifyCharacter(deps, a.id), verifyCharacter(deps, b.id)]);
    expect(results.sort()).toEqual(["already_verified_by_another_user", "verified"]);
  });
  it("discards a fetched verification after the token is reissued", async () => {
    const c = await register();
    let release!: (value: ReturnType<typeof fakeLodestoneCharacter>) => void;
    let started!: () => void;
    const fetching = new Promise<void>((r) => {
      started = r;
    });
    const pending = new Promise<ReturnType<typeof fakeLodestoneCharacter>>((r) => {
      release = r;
    });
    const task = verifyCharacter(
      {
        ...deps,
        lodestone: {
          ...lodestone,
          searchCharacter: lodestone.searchCharacter.bind(lodestone),
          fetchCharacter: async () => {
            started();
            return pending;
          },
        },
      },
      c.id,
    );
    await fetching;
    const replacement = await reissueToken(deps, alice, c.id);
    release(
      fakeLodestoneCharacter({ lodestoneId: "1001", selfIntroduction: c.verification!.token }),
    );
    expect(await task).toBe("skipped");
    expect((await listCharacters(db, alice))[0]).toMatchObject({
      verified: false,
      verification: replacement.verification,
      verificationError: null,
    });
  });
  it("rechecks expiration after fetching the introduction", async () => {
    const c = await register();
    const source = {
      searchCharacter: lodestone.searchCharacter.bind(lodestone),
      fetchCharacter: async () => {
        now = new Date(now.getTime() + 86_400_000);
        return fakeLodestoneCharacter({
          lodestoneId: "1001",
          selfIntroduction: c.verification!.token,
        });
      },
    };
    expect(await verifyCharacter({ ...deps, lodestone: source }, c.id)).toBe("token_expired");
  });
  it("discards verification fetched before the character is deleted", async () => {
    const c = await register();
    const source = {
      searchCharacter: lodestone.searchCharacter.bind(lodestone),
      fetchCharacter: async () => {
        await deleteCharacter(db, alice, c.id);
        return fakeLodestoneCharacter({
          lodestoneId: "1001",
          selfIntroduction: c.verification!.token,
        });
      },
    };
    expect(await verifyCharacter({ ...deps, lodestone: source }, c.id)).toBe("skipped");
    expect(await listCharacters(db, alice)).toEqual([]);
  });
  it("never lets another user change a character", async () => {
    const c = await register();
    await expect(setPrimaryCharacter(db, bob, c.id)).rejects.toMatchObject({ code: "not_found" });
    await expect(deleteCharacter(db, bob, c.id)).rejects.toMatchObject({ code: "not_found" });
    await expect(reissueToken(deps, bob, c.id)).rejects.toMatchObject({ code: "not_found" });
  });
  it("switches the primary character", async () => {
    await register();
    const second = await register(alice, "1002");
    await setPrimaryCharacter(db, alice, second.id);
    expect((await listCharacters(db, alice)).map((c) => c.isPrimary)).toEqual([false, true]);
  });
  it("keeps one primary under concurrent switches", async () => {
    const first = await register();
    const second = await register(alice, "1002");
    await Promise.all([
      setPrimaryCharacter(db, alice, first.id),
      setPrimaryCharacter(db, alice, second.id),
    ]);
    expect((await listCharacters(db, alice)).filter((c) => c.isPrimary)).toHaveLength(1);
  });
  it("promotes the oldest remaining character after deleting the primary", async () => {
    const first = await register();
    const second = await register(alice, "1002");
    await deleteCharacter(db, alice, first.id);
    expect(await listCharacters(db, alice)).toMatchObject([{ id: second.id, isPrimary: true }]);
  });
  it("rejects manual sync of an unverified character", async () => {
    const c = await register();
    await expect(requestSync(deps, alice, c.id)).rejects.toMatchObject({ message: "not_verified" });
  });
  it("limits manual sync to one request per day even before the job runs", async () => {
    const c = await verified();
    now = new Date(now.getTime() + 86_400_000);
    await requestSync(deps, alice, c.id);
    await expect(requestSync(deps, alice, c.id)).rejects.toMatchObject({
      message: "sync_too_soon",
    });
    expect(jobs.jobs).toHaveLength(1);
    expect(jobs.jobs[0]).toMatchObject({
      name: "character-sync",
      data: { characterId: c.id },
      opts: { singletonKey: c.id, retryLimit: 0 },
    });
  });
  it("rolls back the request timestamp if job enqueue fails", async () => {
    const c = await verified();
    now = new Date(now.getTime() + 86_400_000);
    await expect(
      requestSync(
        {
          ...deps,
          jobs: {
            enqueue: async () => {
              throw new Error("test-queue-failed");
            },
          },
        },
        alice,
        c.id,
      ),
    ).rejects.toThrow("test-queue-failed");
    await requestSync(deps, alice, c.id);
    expect(jobs.jobs).toHaveLength(1);
  });
  it("accepts only one concurrent manual sync request", async () => {
    const c = await verified();
    now = new Date(now.getTime() + 86_400_000);
    const results = await Promise.allSettled([
      requestSync(deps, alice, c.id),
      requestSync(deps, alice, c.id),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.find((result) => result.status === "rejected")).toMatchObject({
      reason: { message: "sync_too_soon" },
    });
    expect(jobs.jobs).toHaveLength(1);
  });
  it("refreshes a verified profile without requiring the old token", async () => {
    const c = await verified();
    lodestone.add(
      fakeLodestoneCharacter({ lodestoneId: "1001", name: "Test Renamed", world: "Bahamut" }),
    );
    now = new Date(now.getTime() + 86_400_000);
    expect(await syncCharacter(deps, c.id)).toBe("synced");
    expect((await listCharacters(db, alice))[0]).toMatchObject({
      name: "Test Renamed",
      world: "Bahamut",
      verified: true,
      lastSyncedAt: now.toISOString(),
    });
  });
  it("preserves verification and reports three consecutive sync failures", async () => {
    const c = await verified();
    for (let i = 0; i < 3; i++) {
      lodestone.failNextWith = new LodestoneError("parse_error");
      expect(await syncCharacter(deps, c.id)).toBe("failed");
    }
    expect((await listCharacters(db, alice))[0]).toMatchObject({
      verified: true,
      syncError: "parse_error",
    });
    await syncCharacter(deps, c.id);
    const [row] = await db.select().from(schema.characters).where(eq(schema.characters.id, c.id));
    expect(row).toMatchObject({ syncError: null, syncFailures: 0 });
  });
  it("skips deleted characters in queued jobs", async () => {
    const c = await verified();
    await deleteCharacter(db, alice, c.id);
    expect(await verifyCharacter(deps, c.id)).toBe("skipped");
    expect(await syncCharacter(deps, c.id)).toBe("skipped");
  });
  it("preserves the count of concurrent failed syncs", async () => {
    const c = await verified();
    const source = {
      searchCharacter: lodestone.searchCharacter.bind(lodestone),
      fetchCharacter: async () => {
        throw new LodestoneError("unavailable");
      },
    };
    await Promise.all([
      syncCharacter({ ...deps, lodestone: source }, c.id),
      syncCharacter({ ...deps, lodestone: source }, c.id),
    ]);
    const row = await db.query.characters.findFirst({ where: eq(schema.characters.id, c.id) });
    expect(row).toMatchObject({ syncFailures: 2, syncError: null, verifiedAt: now });
  });
  it("skips background requests when Lodestone is disabled", async () => {
    const c = await verified();
    lodestone.calls.length = 0;
    expect(await syncCharacter({ ...deps, enabled: false }, c.id)).toBe("skipped");
    expect(await verifyCharacter({ ...deps, enabled: false }, c.id)).toBe("skipped");
    expect(lodestone.calls).toEqual([]);
  });
  it("enforces a unique verified Lodestone id at the database boundary", async () => {
    await verified();
    const other = await register(bob);
    await expect(
      db
        .update(schema.characters)
        .set({ verifiedAt: now })
        .where(eq(schema.characters.id, other.id)),
    ).rejects.toMatchObject({ cause: { code: "23505" } });
  });
});
