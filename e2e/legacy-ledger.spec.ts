import { randomUUID } from "node:crypto";
import { createDatabase, schema } from "@lumorphia-accounts/db";
import { e2eDatabaseUrl } from "./database.ts";
import { importLegacyLedger } from "../packages/core/src/domain/legacy-ledger.ts";
import { expect, test } from "./test.ts";
import { gotoHydrated } from "./helpers.ts";
const stamp = randomUUID().slice(0, 8);
const oldHandle = `old_${stamp}`;
const identity = { providerId: "discord", accountId: `test-e2e-old-${stamp}` };
test.beforeAll(async () => {
  const database = createDatabase(e2eDatabaseUrl());
  try {
    // E2E 専用 DB の前回の台帳だけを入れ替える。
    await database.db.delete(schema.legacyAccounts);
    await database.db.delete(schema.legacyImports);
    await importLegacyLedger(database.db, {
      service: "prismtone",
      accounts: [{ legacyUserId: randomUUID(), handle: oldHandle, identities: [identity] }],
    });
  } finally {
    await database.close();
  }
});
test("offers the old Prismtone handle during onboarding and keeps the migration guide after setup", async ({
  page,
}) => {
  await gotoHydrated(page, "/login");
  const userId = await page.evaluate(async (handle) => {
    const res = await fetch("/api/auth/dev/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ handle, onboarded: false }),
    });
    return (await res.json()).userId as string;
  }, `new_${stamp}`);
  const database = createDatabase(e2eDatabaseUrl());
  try {
    await database.db.insert(schema.accounts).values({ userId, ...identity });
  } finally {
    await database.close();
  }
  await gotoHydrated(page, "/welcome");
  const guide = page.getByTestId("legacy-migration-guide");
  await expect(guide).toContainText("Prismtone のアカウントが見つかりました");
  await expect(guide).toContainText("移行期限はありません");
  await guide.getByRole("button", { name: "Prismtone の ID を使う" }).click();
  await expect(page.getByTestId("welcome-handle")).toHaveValue(oldHandle);
  await page.getByLabel("15歳以上です").check();
  await page.getByLabel("利用規約とプライバシーポリシーを読み、同意します").check();
  await page.getByRole("button", { name: "設定を完了" }).click();
  await page.waitForURL("/");
  await expect(page.getByTestId("legacy-migration-guide")).toBeVisible();
  await gotoHydrated(page, "/settings");
  await expect(page.getByRole("link", { name: "Prismtone で引き継ぐ" })).toHaveAttribute(
    "href",
    "https://prismtone.lumorphia.com/settings/migration",
  );
});
test("keeps an unrelated new user out of the reserved handle and does not show a migration notice", async ({
  page,
}) => {
  await gotoHydrated(page, "/login");
  await page.evaluate(async (handle) => {
    await fetch("/api/auth/dev/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ handle, onboarded: false }),
    });
  }, `oth_${stamp}`);
  await gotoHydrated(page, "/welcome");
  await expect(page.getByTestId("welcome-handle")).toBeVisible();
  await expect(page.getByTestId("legacy-migration-guide")).toHaveCount(0);
  const result = await page.evaluate(async (handle) => {
    const res = await fetch("/api/me/onboarding", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        handle,
        name: "Test",
        consent: { termsVersion: "1.0", privacyVersion: "1.0", ageConfirmed: true },
      }),
    });
    return res.status;
  }, oldHandle);
  expect(result).toBe(409);
});
