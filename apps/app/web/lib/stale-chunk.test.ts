import { describe, expect, it } from "vitest";
import { isStaleChunkError } from "./stale-chunk.ts";

describe("isStaleChunkError", () => {
  it("Chrome の動的 import の失敗を見分ける", () => {
    const error = new TypeError(
      "Failed to fetch dynamically imported module: https://x.test/assets/edit-client-loader-BKRljYjI.js",
    );
    expect(isStaleChunkError(error)).toBe(true);
  });

  it("Firefox の動的 import の失敗を見分ける", () => {
    expect(isStaleChunkError(new TypeError("error loading dynamically imported module"))).toBe(
      true,
    );
  });

  it("Safari の動的 import の失敗を見分ける", () => {
    expect(isStaleChunkError(new TypeError("Importing a module script failed."))).toBe(true);
  });

  it("文字列で渡ってきた理由も見分ける", () => {
    expect(isStaleChunkError("Failed to fetch dynamically imported module: /a.js")).toBe(true);
  });

  it("ほかのエラーは古いファイルのエラーと見なさない", () => {
    expect(isStaleChunkError(new TypeError("Failed to fetch"))).toBe(false);
    expect(isStaleChunkError(null)).toBe(false);
  });
});
