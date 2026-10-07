import { createDatabase, eq, schema, sql } from "@lumorphia-accounts/db";
import { e2eDatabaseUrl } from "./database.ts";
import { expect, test } from "./test.ts";
import { gotoHydrated } from "./helpers.ts";

const mock = `http://127.0.0.1:${process.env.MOCK_LODESTONE_PORT ?? 3404}`;
test.describe("character settings", () => {
  test.describe.configure({ mode: "serial" });
  test("registers, reissues, verifies and removes a character over HTTPS", async ({ page }) => {
    await page.request.post(`${mock}/_e2e/character`, { data: { introduction: "" } });
    await gotoHydrated(page, "/login");
    await page.getByLabel("開発用ログイン").fill(`ch_${Date.now().toString(36)}`);
    await page.getByTestId("dev-login").getByRole("button", { name: "ログイン" }).click();
    await page.waitForURL("/");
    await gotoHydrated(page, "/settings");
    await page
      .getByLabel("Lodestone の URL または ID")
      .fill("https://jp.finalfantasyxiv.com/lodestone/character/15022394/");
    await page.getByRole("button", { name: "キャラクターを登録", exact: true }).click();
    const row = page.getByTestId("character-row");
    await expect(row).toContainText("Hal Myth");
    await expect(row).toContainText("未確認");
    const original = await row.getByLabel("確認用トークン").inputValue();
    await row.getByRole("button", { name: "トークンを再発行" }).click();
    await expect(row.getByLabel("確認用トークン")).not.toHaveValue(original);
    await row.getByRole("button", { name: "所有確認を実行" }).click();
    await expect(row).toContainText("自己紹介にトークンが見つかりません");
    const token = await row.getByLabel("確認用トークン").inputValue();
    await page.request.post(`${mock}/_e2e/character`, { data: { introduction: token } });
    await row.getByRole("button", { name: "所有確認を実行" }).click();
    await expect(row).toContainText("確認済み");
    await expect(row.getByLabel("確認用トークン")).toHaveCount(0);
    await expect(row.getByRole("button", { name: "再同期を依頼" })).toBeDisabled();
    const characterId = await page.evaluate(
      async () => (await (await fetch("/api/me/characters")).json()).characters[0].id as string,
    );
    const database = createDatabase(e2eDatabaseUrl());
    try {
      await database.db
        .update(schema.characters)
        .set({ lastSyncedAt: new Date(Date.now() - 2 * 86_400_000) })
        .where(eq(schema.characters.id, characterId));
      await page.getByRole("button", { name: "一覧を更新" }).click();
      await expect(row.getByRole("button", { name: "再同期を依頼" })).toBeEnabled();
      await row.getByRole("button", { name: "再同期を依頼" }).click();
      await expect(page.getByTestId("character-message")).toContainText("再同期を受け付けました");
      const jobs = await database.db.execute(
        sql`select id from pgboss.job where name = 'character-sync' and data->>'characterId' = ${characterId}`,
      );
      expect(jobs.rows).toHaveLength(1);
    } finally {
      await database.close();
    }
    await row.getByRole("button", { name: "登録を解除", exact: true }).click();
    await row.getByRole("button", { name: "解除する", exact: true }).click();
    await expect(row).toHaveCount(0);
  });
  test("finds the owner fixture by name and world and keeps failures actionable", async ({
    page,
  }) => {
    await page.request.post(`${mock}/_e2e/character`, { data: { introduction: "" } });
    await gotoHydrated(page, "/login");
    await page.getByLabel("開発用ログイン").fill(`cs_${Date.now().toString(36)}`);
    await page.getByTestId("dev-login").getByRole("button", { name: "ログイン" }).click();
    await page.waitForURL("/");
    await gotoHydrated(page, "/settings");
    await page.getByRole("radio", { name: "名前とワールドで検索" }).check();
    await page.getByLabel("キャラクター名", { exact: true }).fill("Unknown Character");
    await page.getByLabel("ワールド", { exact: true }).fill("Tiamat");
    await page.getByRole("button", { name: "キャラクターを登録", exact: true }).click();
    await expect(page.getByTestId("character-message")).toContainText(
      "キャラクターが見つかりません",
    );
    await page.getByLabel("キャラクター名", { exact: true }).fill("Hal Myth");
    await page.getByRole("button", { name: "キャラクターを登録", exact: true }).click();
    const row = page.getByTestId("character-row");
    await expect(row).toContainText("Hal Myth");
    await row.getByRole("button", { name: "登録を解除", exact: true }).click();
    await row.getByRole("button", { name: "キャンセル" }).click();
    await expect(row).toHaveCount(1);
    await row.getByRole("button", { name: "登録を解除", exact: true }).click();
    await row.getByRole("button", { name: "解除する", exact: true }).click();
    await expect(row).toHaveCount(0);
  });
});
