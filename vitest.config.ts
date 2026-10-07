import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: ["apps/*", "packages/*"],
    coverage: {
      provider: "v8",
      // lcov は Codecov 用。text は CI のログで読む用
      reporter: ["text", "html", "lcov"],
      include: ["packages/*/src/**", "apps/app/server/**"],
      exclude: [
        "**/*.test.ts",
        "**/*.d.ts",
        "**/index.ts",
        // Lodestone の HTML は入力データ。実行コードとして解析しない
        "**/fixtures/**",
        "packages/db/src/migrate.ts",
        // テスト基盤 (ファイルごとの専用 DB)。テストの外では使わない
        "packages/db/src/test-database.ts",
        "packages/db/src/vitest-setup.ts",
        "packages/db/src/schema/**",
      ],
      thresholds: { lines: 80, functions: 80, branches: 70, statements: 80 },
    },
  },
});
