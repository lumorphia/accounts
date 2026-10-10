import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, eq, schema, type Database } from "@lumorphia-accounts/db";
import { refreshLinkedAccountProfiles } from "./refresh-account-profiles.ts";
import type { Auth } from "./auth.ts";

const databaseUrl = process.env.DATABASE_URL;
const stamp = Math.random().toString(36).slice(2, 10);
const silentLog = { warn: () => {} } as unknown as Parameters<
  typeof refreshLinkedAccountProfiles
>[0]["log"];

describe.skipIf(!databaseUrl)("refreshLinkedAccountProfiles (PostgreSQL)", () => {
  let db: Database;
  let close: () => Promise<void>;
  let userId: string;
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    ({ db, close } = createDatabase(databaseUrl!));
    const [user] = await db
      .insert(schema.users)
      .values({
        name: "Refresh",
        email: `test-refresh-${stamp}@example.invalid`,
        handle: `refresh_${stamp}`,
        status: "active",
      })
      .returning({ id: schema.users.id });
    userId = user!.id;
    const rows = await db
      .insert(schema.accounts)
      .values([
        { userId, providerId: "discord", accountId: `d-${stamp}` },
        { userId, providerId: "google", accountId: `g-${stamp}` },
        {
          userId,
          providerId: "twitter",
          accountId: `x-${stamp}`,
          imageUrl: "https://x.example/fresh.png",
          displayName: "fresh",
        },
        { userId, providerId: "misskey", accountId: `misskey.test:${stamp}` },
      ])
      .returning({ id: schema.accounts.id, providerId: schema.accounts.providerId });
    for (const row of rows) ids[row.providerId] = row.id;
  });
  afterAll(async () => {
    await db.delete(schema.users).where(eq(schema.users.id, userId));
    await close();
  });

  it("アイコン URL が無い SNS 連携だけ取り直し、失敗した行と misskey と新しい行は触らない", async () => {
    const calls: string[] = [];
    const auth = {
      api: {
        accountInfo: async ({ query }: { query: { accountId: string } }) => {
          calls.push(query.accountId);
          if (query.accountId === ids.google) throw new Error("token expired");
          return {
            user: { name: "Alice", image: "https://cdn.discordapp.com/a.png", emailVerified: true },
            data: { username: "alice_ff14" },
            account: { id: query.accountId, providerId: "discord", accountId: "1" },
          };
        },
      },
    } as unknown as Auth;

    const n = await refreshLinkedAccountProfiles({ db, auth, userId, headers: {}, log: silentLog });
    expect(n).toBe(1);
    expect(calls.sort()).toEqual([ids.discord, ids.google].sort());

    const rows = await db.query.accounts.findMany({ where: eq(schema.accounts.userId, userId) });
    const by = (p: string) => rows.find((r) => r.providerId === p)!;
    expect(by("discord")).toMatchObject({
      displayName: "alice_ff14",
      imageUrl: "https://cdn.discordapp.com/a.png",
    });
    expect(by("google").imageUrl).toBeNull();
    expect(by("twitter")).toMatchObject({ imageUrl: "https://x.example/fresh.png" });
    expect(by("misskey").imageUrl).toBeNull();
  });
});
