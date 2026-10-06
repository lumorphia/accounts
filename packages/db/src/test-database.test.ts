import { describe, expect, it } from "vitest";
import { testDatabaseName } from "./test-database.ts";

describe("testDatabaseName", () => {
  it("names the database after the test file and a hash of its path", () => {
    const name = testDatabaseName(
      "accounts",
      "/repo/packages/core/src/domain/blocked-terms.db.test.ts",
    );
    expect(name).toMatch(/^accounts_t_blocked_terms_[0-9a-f]{8}$/);
  });

  it("gives different names to files with the same basename in different packages", () => {
    const a = testDatabaseName("accounts", "/repo/packages/core/src/domain/posts.db.test.ts");
    const b = testDatabaseName("accounts", "/repo/apps/app/server/routes/posts.db.test.ts");
    expect(a).not.toBe(b);
  });

  it("stays within PostgreSQL's 63 byte identifier limit", () => {
    const name = testDatabaseName("a".repeat(60), `/repo/${"b".repeat(80)}.db.test.ts`);
    expect(name.length).toBeLessThanOrEqual(63);
    expect(name).toMatch(/_[0-9a-f]{8}$/);
  });
});
