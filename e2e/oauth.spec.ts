import type { Page } from "@playwright/test";
import { expect, test } from "./test.ts";
import { gotoHydrated } from "./helpers.ts";

const MOCK_OAUTH = `http://127.0.0.1:${process.env.MOCK_OAUTH_PORT ?? 3401}`;
const AUTHORIZE = {
  discord: "https://discord.com/api/oauth2/authorize**",
  google: "https://accounts.google.com/o/oauth2/v2/auth**",
  twitter: "https://x.com/i/oauth2/authorize**",
} as const;
const LABEL = { discord: "Discord", google: "Google", twitter: "X" };

async function approveAuthorize(page: Page, provider: keyof typeof AUTHORIZE) {
  await page.route(AUTHORIZE[provider], async (route) => {
    const authorize = new URL(route.request().url());
    const callback = new URL(authorize.searchParams.get("redirect_uri")!);
    callback.searchParams.set("code", `mock-code-${provider}`);
    callback.searchParams.set("state", authorize.searchParams.get("state")!);
    await route.fulfill({ status: 302, headers: { location: callback.toString() } });
  });
}

test.describe("social OAuth", () => {
  test.describe.configure({ mode: "serial" });
  for (const provider of ["discord", "google", "twitter"] as const) {
    test(`${provider} signs in and creates a pending account`, async ({ page }) => {
      const id = `${Date.now()}${provider === "discord" ? 1 : provider === "google" ? 2 : 3}`;
      await page.request.post(`${MOCK_OAUTH}/_e2e/${provider}`, {
        data: { id, name: `Test ${provider}` },
      });
      await approveAuthorize(page, provider);
      await gotoHydrated(page, "/login");
      await page.getByRole("button", { name: `${LABEL[provider]} でログイン` }).click();
      await page.waitForURL(
        (url) => !url.pathname.startsWith("/api/auth") && url.pathname !== "/login",
      );
      const me = await page.evaluate(async () => (await fetch("/api/me")).json());
      expect(me.user).toMatchObject({ status: "pending", role: "user" });
      expect(me.user.handle).toMatch(/^pending_/);
    });
  }
});
