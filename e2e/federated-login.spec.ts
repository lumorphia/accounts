import { expect, test } from "./test.ts";
import { gotoHydrated } from "./helpers.ts";

const HOSTS = {
  misskey: `127.0.0.1:${process.env.MOCK_MISSKEY_PORT ?? 3399}`,
  mastodon: `127.0.0.1:${process.env.MOCK_MASTODON_PORT ?? 3402}`,
} as const;

test.describe("federated login", () => {
  for (const provider of ["misskey", "mastodon"] as const) {
    test(`${provider} signs in and creates a pending account`, async ({ page }) => {
      const id = `test-${provider}-${Date.now()}`;
      await page.request.post(`http://${HOSTS[provider]}/_e2e/user`, {
        data: { id, username: `test_${provider}` },
      });
      await gotoHydrated(page, "/login");
      await page
        .getByLabel(`${provider === "misskey" ? "Misskey" : "Mastodon"} のサーバー`)
        .fill(HOSTS[provider]);
      await page.getByTestId(`${provider}-submit`).click();
      await page.waitForURL(
        (url) => url.pathname === "/welcome" && url.hostname === "accounts.lumorphia.test",
      );
      const me = await page.evaluate(async () => (await fetch("/api/me")).json());
      expect(me.user).toMatchObject({ status: "pending", role: "user" });
      expect(me.user.handle).toMatch(/^pending_/);
      const handle = `u_${Date.now().toString(36)}`;
      await page.getByTestId("welcome-handle").fill(handle);
      await page.getByRole("button", { name: "設定を完了" }).click();
      await page.waitForURL("/");
      const active = await page.evaluate(async () => (await fetch("/api/me")).json());
      expect(active.user).toMatchObject({ handle, status: "active" });
      const accounts = await page.evaluate(async () => (await fetch("/api/me/accounts")).json());
      expect(accounts.accounts).toHaveLength(1);
      expect(accounts.accounts[0].displayName).toBeTruthy();
    });
  }
});
