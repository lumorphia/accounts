import { describe, expect, it } from "vitest";
import { isServiceLogin, loginNext } from "./login-next.ts";

describe("loginNext", () => {
  it("resumes the signed authorization query without changing it", () => {
    const query = "client_id=test-client&state=a%2Bb&sig=test-signature&ba_ts=123";
    expect(loginNext(new URLSearchParams(query))).toBe(`/api/auth/oauth2/authorize?${query}`);
  });
  it("keeps the normal local return path", () => {
    expect(loginNext(new URLSearchParams({ next: "/settings?tab=profile" }))).toBe(
      "/settings?tab=profile",
    );
  });
  it("ignores an unsigned authorization request", () => {
    expect(loginNext(new URLSearchParams({ client_id: "test-client" }))).toBe("/");
  });
  it("rejects external return paths", () => {
    for (const next of [
      "https://example.com",
      "//example.com",
      "/\\example.com",
      "/ /../..//example.com",
    ]) {
      expect(loginNext(new URLSearchParams({ next }))).toBe("/");
    }
  });
});

describe("isServiceLogin", () => {
  it("treats a return to the authorization endpoint as a service login in progress", () => {
    expect(isServiceLogin("/api/auth/oauth2/authorize?client_id=test-client")).toBe(true);
  });
  it("does not treat a normal page as a service login", () => {
    expect(isServiceLogin("/settings")).toBe(false);
    expect(isServiceLogin("/")).toBe(false);
  });
});
