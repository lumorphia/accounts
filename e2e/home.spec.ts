import { expect, test } from "./test.ts";
import { gotoHydrated } from "./helpers.ts";
const website = "https://lumorphia.test:3444/";

test("sends an Accounts guest to the login page", async ({ page }) => {
  await gotoHydrated(page, "/");
  await page.waitForURL("**/login");
  await expect(page.getByRole("heading", { name: "Lumorphia にログイン" })).toBeVisible();
});

test("returns to the Lumorphia top after login with a contextual profile menu", async ({
  page,
}) => {
  const handle = `home_${Date.now().toString(36)}`;
  await gotoHydrated(page, "/login");
  await page.getByLabel("開発用ログイン").fill(handle);
  await page.getByTestId("dev-login").getByRole("button", { name: "ログイン" }).click();
  await page.waitForURL(website);
  await expect(page.locator("#account-name")).toHaveText(handle);
  await page.getByRole("button", { name: "アカウントメニュー" }).click();
  const menu = page.locator("#account-menu");
  await expect(menu.getByRole("link", { name: "アカウント管理" })).toBeVisible();
  await expect(menu.getByRole("link", { name: "Lumorphia トップ" })).toHaveCount(0);
  await menu.getByRole("button", { name: "ログアウト" }).click();
  await page.waitForURL(website);
  await expect(page.locator("#account-login")).toBeVisible();
  await expect(page.locator("#account-user")).toBeHidden();
});

test("reports missing enabled workers while the database remains up", async ({ page }) => {
  const res = await page.goto("/api/health");
  expect(res?.status()).toBe(503);
  expect(await res?.json()).toMatchObject({
    ok: false,
    db: "ok",
    workers: { accounts: "stale", characters: "stale" },
  });
});
