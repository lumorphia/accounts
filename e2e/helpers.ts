/**
 * *.lumorphia.test は Chromium の起動オプション (--host-resolver-rules) で 127.0.0.1 に向けている (playwright.config.ts)。
 * ブラウザを通さない `request` フィクスチャ (Node から送る) にはこれが効かず、名前を引けない。
 * API はページから叩く (page.goto や page.evaluate の fetch)
 */
import { expect, type Page } from "@playwright/test";

/** hydration が終わるまで待つ。root の App が html に data-hydrated を付ける */
export async function waitForHydration(page: Page) {
  await expect(page.locator("html")).toHaveAttribute("data-hydrated", "true");
}

/** page.goto して hydration まで待つ。直後にクリックや入力をするときはこちら */
export async function gotoHydrated(page: Page, url: string) {
  await page.goto(url);
  await waitForHydration(page);
}
