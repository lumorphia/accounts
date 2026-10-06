import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    name: "app",
    include: ["server/**/*.test.ts", "web/**/*.test.ts"],
    setupFiles: ["../../packages/db/src/vitest-setup.ts"],
  },
});
