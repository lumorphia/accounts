import { expect, test } from "./test.ts";
import { gotoHydrated } from "./helpers.ts";

test("public legal pages remain readable without signing in", async ({ page }) => {
  await gotoHydrated(page, "/login?next=%2Fsettings");
  await page.getByRole("link", { name: "利用規約", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Lumorphia アカウント 利用規約", exact: true }),
  ).toBeVisible();
  await expect(page.locator("main")).toContainText("15歳以上");
  await page.getByRole("link", { name: "プライバシーポリシー", exact: true }).last().click();
  await expect(
    page.getByRole("heading", { name: "Lumorphia アカウント プライバシーポリシー", exact: true }),
  ).toBeVisible();
  await expect(page.locator("main")).toContainText("lumorphia:identities");
});

test("onboarding requires both legal consent and an age confirmation", async ({ page }) => {
  await gotoHydrated(page, "/login?next=%2Fsettings");
  await page.evaluate(async () => {
    await fetch("/api/auth/dev/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ handle: `law_${Date.now().toString(36)}`, onboarded: false }),
    });
  });
  await gotoHydrated(page, "/welcome");
  const submit = page.getByRole("button", { name: "設定を完了" });
  await expect(submit).toBeDisabled();
  await page.getByLabel("15歳以上です").check();
  await expect(submit).toBeDisabled();
  await page.getByLabel("利用規約とプライバシーポリシーを読み、同意します").check();
  await expect(submit).toBeEnabled();
});
