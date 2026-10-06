import { describe, expect, it } from "vitest";
import { localRedirect } from "./local-redirect.ts";

describe("localRedirect", () => {
  it("keeps a relative path on this site", () => {
    expect(localRedirect("/settings?tab=accounts")).toBe("/settings?tab=accounts");
  });
  it("falls back to home for an external or ambiguous path", () => {
    for (const value of [
      "//evil.example",
      "/\\evil.example",
      "https://evil.example",
      "\\\\evil.example",
    ]) {
      expect(localRedirect(value)).toBe("/");
    }
  });
});
