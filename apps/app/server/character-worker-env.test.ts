import { describe, expect, it } from "vitest";
import { loadCharacterWorkerEnv } from "./character-worker-env.ts";

describe("character worker configuration", () => {
  it("disables Lodestone unless explicitly enabled", () => {
    expect(
      loadCharacterWorkerEnv({ DATABASE_URL: "postgres://test:test@localhost/test" }),
    ).toMatchObject({
      FEATURE_LODESTONE: false,
      LODESTONE_BASE_URL: "https://jp.finalfantasyxiv.com",
    });
  });
  it("accepts a mock Lodestone in development", () => {
    expect(
      loadCharacterWorkerEnv({
        DATABASE_URL: "postgres://test:test@localhost/test",
        FEATURE_LODESTONE: "true",
        LODESTONE_BASE_URL: "http://127.0.0.1:4999",
      }).FEATURE_LODESTONE,
    ).toBe(true);
  });
  it("rejects invalid feature settings", () => {
    expect(() =>
      loadCharacterWorkerEnv({
        DATABASE_URL: "postgres://test:test@localhost/test",
        FEATURE_LODESTONE: "yes",
      }),
    ).toThrow();
  });
  it("requires a User-Agent in production when fetching is enabled", () => {
    expect(() =>
      loadCharacterWorkerEnv({
        NODE_ENV: "production",
        DATABASE_URL: "postgres://test:test@localhost/test",
        FEATURE_LODESTONE: "1",
      }),
    ).toThrow("LODESTONE_USER_AGENT");
  });
  it("rejects a mock Lodestone in production", () => {
    expect(() =>
      loadCharacterWorkerEnv({
        NODE_ENV: "production",
        DATABASE_URL: "postgres://test:test@localhost/test",
        FEATURE_LODESTONE: "1",
        LODESTONE_USER_AGENT: "lumorphia-accounts/test (+https://accounts.example.invalid/about)",
        LODESTONE_BASE_URL: "http://127.0.0.1:4999",
      }),
    ).toThrow("LODESTONE_BASE_URL");
  });
  it("accepts production configuration with identification", () => {
    expect(
      loadCharacterWorkerEnv({
        NODE_ENV: "production",
        DATABASE_URL: "postgres://test:test@localhost/test",
        FEATURE_LODESTONE: "1",
        LODESTONE_USER_AGENT: "lumorphia-accounts/test (+https://accounts.example.invalid/about)",
      }).FEATURE_LODESTONE,
    ).toBe(true);
  });
});
