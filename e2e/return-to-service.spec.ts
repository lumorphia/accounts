import { randomBytes } from "node:crypto";
import type { Page } from "@playwright/test";
import { eq, schema } from "@lumorphia-accounts/db";
import { buildApp } from "../apps/app/server/app.ts";
import { loadEnv } from "../apps/app/server/env.ts";
import { registerServiceClient } from "../apps/app/server/auth/oidc-clients.ts";
import { e2eDatabaseUrl } from "./database.ts";
import { expect, test } from "./test.ts";
import { gotoHydrated } from "./helpers.ts";

const origin = `https://accounts.lumorphia.test:${process.env.E2E_PORT ?? 3443}`;
const headers = { host: new URL(origin).host, origin, "x-forwarded-proto": "https" };
// このファイルだけで使うサービスの origin。ほかの spec の登録とぶつけない
const service = `https://rt-${randomBytes(4).toString("hex")}.lumorphia.test:8444`;
const back = `${service}/settings?lumorphia=updated`;

// サービスの設定から移ってきた人を戻すリンク (prismtone ADR-0052)
test.describe("return to the service from settings", () => {
  test.beforeAll(async () => {
    const app = await buildApp({
      env: loadEnv({
        NODE_ENV: "test",
        DATABASE_URL: e2eDatabaseUrl(),
        AUTH_BASE_URL: origin,
        AUTH_SECRET: "test-e2e-secret-test-e2e-secret-1234",
        LOG_LEVEL: "silent",
      }),
    });
    try {
      await app.ready();
      const login = await app.inject({
        method: "POST",
        url: "/api/auth/dev/login",
        headers,
        payload: { handle: `rt_${randomBytes(5).toString("hex")}` },
      });
      const raw = login.headers["set-cookie"];
      const cookie = (Array.isArray(raw) ? raw : [String(raw)])
        .map((v) => v.split(";")[0])
        .join("; ");
      await app.db
        .update(schema.users)
        .set({ role: "admin" })
        .where(eq(schema.users.id, login.json().userId));
      await registerServiceClient(app.auth, new Headers({ cookie }), {
        service: "prismtone",
        redirectUri: `${service}/api/auth/callback/lumorphia`,
      });
    } finally {
      await app.close();
    }
  });

  async function devLogin(page: Page) {
    await page.getByLabel("開発用ログイン").fill(`rb_${randomBytes(5).toString("hex")}`);
    await page.getByTestId("dev-login").getByRole("button", { name: "ログイン" }).click();
  }

  test("shows a link back to a registered service", async ({ page }) => {
    await gotoHydrated(page, "/login");
    await devLogin(page);
    await page.waitForURL("/");
    await gotoHydrated(page, `/settings?return_to=${encodeURIComponent(back)}`);
    await expect(page.getByTestId("return-to-service")).toHaveText("Prismtone に戻る");
    await expect(page.getByTestId("return-to-service")).toHaveAttribute("href", back);
  });

  test("shows no link for an unregistered site", async ({ page }) => {
    await gotoHydrated(page, "/login");
    await devLogin(page);
    await page.waitForURL("/");
    await gotoHydrated(
      page,
      `/settings?return_to=${encodeURIComponent("https://evil.example/settings")}`,
    );
    await expect(page.getByTestId("settings-name")).toBeVisible();
    await expect(page.getByTestId("return-to-service")).toHaveCount(0);
  });

  test("keeps the way back through login", async ({ page }) => {
    await gotoHydrated(page, `/settings?return_to=${encodeURIComponent(back)}`);
    await page.waitForURL("**/login?next=**");
    await devLogin(page);
    await page.waitForURL("**/settings?return_to=**");
    await expect(page.getByTestId("return-to-service")).toHaveAttribute("href", back);
  });
});
