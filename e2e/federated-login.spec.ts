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
        (url) => url.pathname === "/" && url.hostname === "accounts.lumorphia.test",
      );
      const me = await page.evaluate(async () => (await fetch("/api/me")).json());
      expect(me.user).toMatchObject({ status: "pending", role: "user" });
      expect(me.user.handle).toMatch(/^pending_/);
    });
  }
});
