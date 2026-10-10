import { expect, test } from "./test.ts";
import { gotoHydrated } from "./helpers.ts";

test("login explains the shared account and supports theme switching", async ({ page }) => {
  await gotoHydrated(page, "/login");
  await expect(page.getByText("ひとつのアカウントで、", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "ダーク表示に切り替える" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
});

test("management uses a contextual account menu and matching page title", async ({ page }) => {
  await gotoHydrated(page, "/login?next=%2Fsettings");
  await page.getByLabel("開発用ログイン").fill(`brand_${Date.now().toString(36)}`);
  await page.getByTestId("dev-login").getByRole("button", { name: "ログイン" }).click();
  await page.waitForURL("**/settings");
  await expect(page.getByRole("heading", { level: 1, name: "アカウント管理" })).toBeVisible();
  await page.getByRole("button", { name: "アカウントメニュー" }).click();
  await expect(
    page.getByTestId("account-menu").getByRole("link", { name: "Lumorphia トップ" }),
  ).toBeVisible();
  await expect(
    page.getByTestId("account-menu").getByRole("link", { name: "アカウント管理" }),
  ).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("account-menu")).toBeHidden();
});

for (const width of [1440, 390, 320]) {
  test(`brand pages fit ${width}px with a long display name`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    const capture = async (view: string) => {
      for (const theme of ["light", "dark"]) {
        const current = await page.locator("html").getAttribute("data-theme");
        if (current !== theme)
          await page
            .getByRole("button", {
              name: theme === "dark" ? "ダーク表示に切り替える" : "ライト表示に切り替える",
            })
            .click();
        const overflow = await page.evaluate(() =>
          [...document.querySelectorAll("body *")]
            .filter((el) => {
              const rect = el.getBoundingClientRect();
              return rect.width > 0 && (rect.right > innerWidth + 1 || rect.left < -1);
            })
            .map((el) => ({
              tag: el.tagName,
              class: el.className,
              right: el.getBoundingClientRect().right,
            })),
        );
        await expect
          .poll(() => page.evaluate(() => document.documentElement.scrollWidth > innerWidth), {
            message: JSON.stringify({ view, theme, overflow }),
          })
          .toBe(false);
        if (width !== 320)
          await page.screenshot({
            path: `docs/design/implemented/${view}-${width === 1440 ? "pc" : "sp"}-${theme}.png`,
            fullPage: true,
            animations: "disabled",
            ...(view !== "home" ? { style: ".dev-login { display: none !important; }" } : {}),
          });
      }
    };
    await gotoHydrated(page, "/login");
    await capture("login");
    const handle = `ui_${width}_${Date.now().toString(36)}`;
    await page.evaluate(async (id) => {
      await fetch("/api/auth/dev/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ handle: id, onboarded: false }),
      });
    }, handle);
    await gotoHydrated(page, "/welcome?next=%2Fsettings");
    await expect(page.getByLabel("ユーザーID", { exact: true })).toBeVisible();
    await capture("welcome");
    await page
      .getByLabel("表示名", { exact: true })
      .fill("長い表示名でレイアウトを確認します".repeat(2));
    await page.getByLabel("ユーザーID", { exact: true }).fill(handle);
    await page.getByLabel("私は15歳以上です").check();
    await page.getByLabel("利用規約とプライバシーポリシーを読み、同意します").check();
    await page.getByRole("button", { name: "設定を完了" }).click();
    await page.waitForURL("**/settings");
    await expect(page.getByTestId("settings-name")).toBeVisible();
    await capture("settings");
    await page.getByRole("button", { name: "アカウントメニュー" }).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(
      false,
    );
    await page.keyboard.press("Escape");
    await page.getByRole("link", { name: "Lumorphia に戻る" }).click();
    await page.waitForURL("https://lumorphia.test:3444/");
    await expect(page.locator("#account-user")).toBeVisible();
    await capture("home");
    await page.getByRole("button", { name: "アカウントメニュー" }).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(
      false,
    );
    await page.locator("#account-menu").getByRole("link", { name: "アカウント管理" }).click();
    await page.waitForURL("**/settings");
    await expect(page.getByRole("heading", { level: 1, name: "アカウント管理" })).toBeVisible();
  });
}
