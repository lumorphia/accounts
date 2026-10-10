import { describe, expect, it } from "vitest";
import {
  HANDLE_CHANGE_COOLDOWN_DAYS,
  isPendingHandle,
  suggestHandle,
  validateHandle,
} from "./handle.ts";

describe("validateHandle", () => {
  it("accepts 3..20 lowercase letters, digits, and underscores", () => {
    expect(validateHandle("abc")).toEqual({ ok: true });
    expect(validateHandle("hiro_2026")).toEqual({ ok: true });
    expect(validateHandle("a".repeat(20))).toEqual({ ok: true });
  });

  it("rejects malformed values", () => {
    for (const value of ["ab", "a".repeat(21), "Hiro", "hiro-1", "ひろ", " hiro", ""]) {
      expect(validateHandle(value)).toEqual({ ok: false, reason: "invalid" });
    }
  });

  it("rejects reserved words and pending placeholders", () => {
    for (const value of ["admin", "settings", "api", "posts", "pending_abc123"]) {
      expect(validateHandle(value)).toEqual({ ok: false, reason: "reserved" });
    }
  });
});

describe("suggestHandle", () => {
  it("normalizes a display name into a candidate", () => {
    expect(suggestHandle("Hiro Shinosawa")).toBe("hiro_shinosawa");
    expect(suggestHandle("篠澤広")).toBe("");
    expect(suggestHandle("ab")).toBe("ab");
    expect(suggestHandle("a".repeat(30))).toHaveLength(20);
  });
});

it("exposes the cooldown and pending helpers", () => {
  expect(HANDLE_CHANGE_COOLDOWN_DAYS).toBe(30);
  expect(isPendingHandle("pending_0123456789ab")).toBe(true);
  expect(isPendingHandle("hiro")).toBe(false);
});
