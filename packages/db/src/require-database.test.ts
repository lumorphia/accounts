import { describe, expect, it } from "vitest";
import { databaseUrlForTest } from "./require-database.ts";

describe("databaseUrlForTest", () => {
  it("returns the database URL when it is set", () => {
    expect(databaseUrlForTest({ DATABASE_URL: "postgres://x/y" })).toBe("postgres://x/y");
  });

  it("returns undefined outside CI so DB tests are skipped on a machine without PostgreSQL", () => {
    expect(databaseUrlForTest({})).toBeUndefined();
  });

  it("throws in CI so DB tests are not skipped into a green run", () => {
    expect(() => databaseUrlForTest({ CI: "true" })).toThrow(/DATABASE_URL/);
  });
});
