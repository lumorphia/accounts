import { defineConfig } from "@playwright/test";
import { DEFAULT_DATABASE_URL, e2eDatabaseUrl } from "./e2e/database.ts";

const PORT = Number(process.env.E2E_PORT ?? 3443);
const HOST = "accounts.lumorphia.test";
const TLS = new URL(".data/tls/", import.meta.url).pathname;

/**
 * E2E は https で回す (ADR-0002、ADR-0003)。証明書は scripts/dev-certs.sh が作る手元専用の CA のもの。
 * *.lumorphia.test は Chromium の起動オプションで 127.0.0.1 に向ける (/etc/hosts を触らない)
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: `https://${HOST}:${PORT}`,
    locale: "ja-JP",
    trace: "retain-on-failure",
    // 手元専用の CA はブラウザが知らない。証明書の検証は scripts/dev-certs.sh と openssl verify で確かめる
    ignoreHTTPSErrors: true,
    launchOptions: { args: [`--host-resolver-rules=MAP *.lumorphia.test 127.0.0.1`] },
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
  webServer: [
    {
      // DB の用意 → ビルド → 本番と同じ起動 (NODE_ENV=test)
      command:
        "node e2e/prepare-db.ts && pnpm --filter @lumorphia-accounts/app build && pnpm --filter @lumorphia-accounts/app exec node server/index.ts",
      url: `https://127.0.0.1:${PORT}/api/health`,
      ignoreHTTPSErrors: true,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: {
        NODE_ENV: "test",
        PORT: String(PORT),
        HOST: "127.0.0.1",
        DATABASE_URL: e2eDatabaseUrl(),
        E2E_BASE_DATABASE_URL: process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL,
        DEV_TLS_CERT: `${TLS}cert.pem`,
        DEV_TLS_KEY: `${TLS}key.pem`,
        API_RATE_LIMIT_DISABLED: "1",
        LOG_LEVEL: "warn",
      },
    },
  ],
});
