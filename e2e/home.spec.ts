import { expect, test } from "./test.ts";
import { gotoHydrated } from "./helpers.ts";

test("serves the top page over https on the lumorphia.test host", async ({ page }) => {
  await gotoHydrated(page, "/");
  expect(new URL(page.url()).protocol).toBe("https:");
  expect(new URL(page.url()).hostname).toBe("accounts.lumorphia.test");
  await expect(page.getByRole("heading", { name: "Lumorphia アカウント" })).toBeVisible();
});

test("reports missing enabled workers while the database remains up", async ({ page }) => {
  // request フィクスチャは Node から送るので、ブラウザの起動オプションの名前の向け先が効かない (helpers.ts)
  const res = await page.goto("/api/health");
  expect(res?.status()).toBe(503);
  expect(await res?.json()).toMatchObject({
    ok: false,
    db: "ok",
    workers: { accounts: "stale", characters: "stale" },
  });
});
