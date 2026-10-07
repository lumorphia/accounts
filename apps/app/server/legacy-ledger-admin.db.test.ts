import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { eq, schema } from "@lumorphia-accounts/db";
import { buildApp } from "./app.ts";
import { loadEnv } from "./env.ts";
import { manageLegacyLedger } from "./legacy-ledger-admin.ts";
const url = process.env.DATABASE_URL;
describe.skipIf(!url)("legacy ledger administrative import (PostgreSQL)", () => {
  let app: FastifyInstance, cookie: string, userId: string;
  const stamp = randomUUID().slice(0, 8),
    legacyUserId = randomUUID();
  const snapshot = {
    service: "prismtone",
    accounts: [
      {
        legacyUserId,
        handle: `old_${stamp}`,
        identities: [{ providerId: "discord", accountId: `test-import-${stamp}` }],
      },
    ],
  };
  beforeAll(async () => {
    const origin = "https://accounts.lumorphia.test:3443";
    app = await buildApp({
      env: loadEnv({
        NODE_ENV: "test",
        DATABASE_URL: url,
        AUTH_BASE_URL: origin,
        LOG_LEVEL: "silent",
      }),
    });
    await app.ready();
    await app.db.delete(schema.legacyAccounts);
    await app.db.delete(schema.legacyImports);
    const login = await app.inject({
      method: "POST",
      url: "/api/auth/dev/login",
      headers: { host: new URL(origin).host, origin },
      payload: { handle: `li_${stamp}` },
    });
    const raw = login.headers["set-cookie"];
    cookie = (Array.isArray(raw) ? raw : [String(raw)])
      .map((v) => String(v).split(";")[0])
      .join("; ");
    userId = login.json().userId;
  });
  afterAll(async () => {
    await app?.close();
  });
  const deps = (cookieValue = cookie) => ({
    db: app.db,
    auth: app.auth,
    headers: new Headers({ cookie: cookieValue }),
  });
  it("refuses import without a current administrator session", async () => {
    await expect(
      manageLegacyLedger(deps(""), { kind: "import", snapshot, apply: true }),
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      manageLegacyLedger(deps(), { kind: "import", snapshot, apply: true }),
    ).rejects.toMatchObject({ code: "forbidden" });
    expect(await app.db.query.legacyAccounts.findMany()).toEqual([]);
  });
  it("previews and applies the minimal ledger only after explicit administrator apply", async () => {
    await app.db.update(schema.users).set({ role: "admin" }).where(eq(schema.users.id, userId));
    expect(
      await manageLegacyLedger(deps(), { kind: "import", snapshot, apply: false }),
    ).toMatchObject({ imported: 1 });
    expect(await app.db.query.legacyAccounts.findMany()).toEqual([]);
    expect(
      await manageLegacyLedger(deps(), { kind: "import", snapshot, apply: true }),
    ).toMatchObject({ imported: 1, repeated: false });
    expect(
      await manageLegacyLedger(deps(), { kind: "import", snapshot, apply: true }),
    ).toMatchObject({ repeated: true });
  });
  it("requires an active administrator before releasing a permanently removed account", async () => {
    await app.db
      .update(schema.users)
      .set({ status: "suspended" })
      .where(eq(schema.users.id, userId));
    await expect(
      manageLegacyLedger(deps(), { kind: "release", legacyUserId }),
    ).rejects.toMatchObject({ code: "forbidden" });
    await app.db.update(schema.users).set({ status: "active" }).where(eq(schema.users.id, userId));
    expect(await manageLegacyLedger(deps(), { kind: "release", legacyUserId })).toEqual({
      released: true,
    });
  });
});
