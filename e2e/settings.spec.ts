import { expect, test } from "./test.ts";
import { gotoHydrated } from "./helpers.ts";

test("settings saves a name and explains the handle change limit", async ({ page }) => {
  const handle = `s_${Date.now().toString(36)}`;
  await gotoHydrated(page, "/login");
  await page.getByLabel("開発用ログイン").fill(handle);
  await page.getByTestId("dev-login").getByRole("button", { name: "ログイン" }).click();
  await page.waitForURL("/");

  await gotoHydrated(page, "/settings");
  await expect(page.getByTestId("settings-handle")).toHaveValue(handle);
  await expect(page.getByTestId("settings-handle")).toBeDisabled();
  await expect(page.getByTestId("settings-handle-locked")).toContainText("30 日");
  await page.getByTestId("settings-name").fill("設定から変更した名前");
  await page.getByTestId("settings-save").click();
  await expect(page.getByTestId("settings-profile-message")).toHaveText("保存しました");
  const me = await page.evaluate(async () => (await fetch("/api/me")).json());
  expect(me.user.name).toBe("設定から変更した名前");
  await expect(page.getByTestId("linked-account")).toHaveCount(1);
  await expect(page.getByTestId("unlink-account")).toBeDisabled();
});

test("settings connects and removes a second account", async ({ page }) => {
  const handle = `l_${Date.now().toString(36)}`;
  const id = `${Date.now()}9`;
  await page.request.post(`http://127.0.0.1:${process.env.MOCK_OAUTH_PORT ?? 3401}/_e2e/discord`, {
    data: { id, name: "Linked Discord" },
  });
  await page.route("https://discord.com/api/oauth2/authorize**", async (route) => {
    const authorize = new URL(route.request().url());
    const callback = new URL(authorize.searchParams.get("redirect_uri")!);
    callback.searchParams.set("code", "mock-code-discord");
    callback.searchParams.set("state", authorize.searchParams.get("state")!);
    await route.fulfill({ status: 302, headers: { location: callback.toString() } });
  });
  await gotoHydrated(page, "/login");
  await page.getByLabel("開発用ログイン").fill(handle);
  await page.getByTestId("dev-login").getByRole("button", { name: "ログイン" }).click();
  await page.waitForURL("/");

  await gotoHydrated(page, "/settings");
  await page.getByRole("button", { name: "Discord を接続" }).click();
  await page.waitForURL("**/settings");
  await expect(page.getByTestId("linked-account")).toHaveCount(2);
  await expect(page.getByTestId("linked-account").filter({ hasText: "Discord" })).toHaveCount(1);
  await page
    .getByTestId("linked-account")
    .filter({ hasText: "Discord" })
    .getByTestId("unlink-account")
    .click();
  await expect(page.getByTestId("linked-account")).toHaveCount(1);
});

test("a pending visitor returns to settings after onboarding", async ({ page }) => {
  const handle = `w_${Date.now().toString(36)}`;
  await gotoHydrated(page, "/login");
  const status = await page.evaluate(async (id) => {
    const res = await fetch("/api/auth/dev/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ handle: id, onboarded: false }),
    });
    return res.status;
  }, handle);
  expect(status).toBe(200);
  await gotoHydrated(page, "/settings");
  await page.waitForURL("**/welcome?next=%2Fsettings");
  await page.getByTestId("welcome-handle").fill(handle);
  await page.getByLabel("15歳以上です").check();
  await page.getByLabel("利用規約とプライバシーポリシーを読み、同意します").check();
  await page.getByRole("button", { name: "設定を完了" }).click();
  await page.waitForURL("**/settings");
  await expect(page.getByTestId("settings-handle")).toHaveValue(handle);
});
