import { describe, expect, it } from "vitest";
import { newToken, parseLodestoneId } from "./characters.ts";

describe("Lodestone registration input", () => {
  it.each([
    "15022394",
    " 15022394 ",
    "https://jp.finalfantasyxiv.com/lodestone/character/15022394/",
    "https://na.finalfantasyxiv.com/lodestone/character/15022394",
  ])("reads the id from %j", (input) => {
    expect(parseLodestoneId(input)).toBe("15022394");
  });
  it.each([
    "0",
    "01",
    "1234567890123",
    "abc",
    "https://example.com/finalfantasyxiv.com/lodestone/character/1/",
    "https://jp.finalfantasyxiv.com.evil.invalid/lodestone/character/1/",
    "http://jp.finalfantasyxiv.com/lodestone/character/1/",
    "https://jp.finalfantasyxiv.com/lodestone/character/1/extra",
    "https://test@jp.finalfantasyxiv.com/lodestone/character/1/",
    "https://jp.finalfantasyxiv.com:8443/lodestone/character/1/",
  ])("rejects %j", (input) => {
    expect(parseLodestoneId(input)).toBeNull();
  });
  it("issues Lumorphia verification tokens", () => {
    expect(newToken()).toMatch(/^lumorphia-[0-9a-f]{8}$/);
  });
});
