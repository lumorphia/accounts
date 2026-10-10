import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema/index.ts",
  out: "./drizzle",
  // pg-boss は自身のスキーマ (pgboss) を持つ。drizzle-kit の管理対象から外す (ADR-0007)
  schemaFilter: ["public"],
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://accounts:accounts@localhost:5434/accounts",
  },
  strict: true,
  verbose: true,
});
