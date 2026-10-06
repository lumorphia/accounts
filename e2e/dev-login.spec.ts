import { expect, test } from "./test.ts";
import { gotoHydrated } from "./helpers.ts";

test("development login creates and reuses a session", async ({ page }) => {
  const handle = `dev_${Date.now().toString(36)}`;
  await gotoHydrated(page, "/login");
  await page.getByLabel("開発用ログイン").fill(handle);
  await page.getByTestId("dev-login").getByRole("button", { name: "ログイン" }).click();
  await page.waitForURL("/");
  const first = await page.evaluate(async () => (await fetch("/api/me")).json());
  expect(first.user).toMatchObject({ handle, status: "active", role: "user" });

  await gotoHydrated(page, "/login");
  await page.getByLabel("開発用ログイン").fill(handle);
  await page.getByTestId("dev-login").getByRole("button", { name: "ログイン" }).click();
  await page.waitForURL("/");
  const second = await page.evaluate(async () => (await fetch("/api/me")).json());
  expect(second.user.id).toBe(first.user.id);
});
