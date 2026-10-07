import { describe, expect, it } from "vitest";
import { isPublicAuthPath } from "./public-endpoints.ts";

describe("isPublicAuthPath", () => {
  it("allows the OIDC protocol endpoints that services call", () => {
    for (const path of [
      "/api/auth/oauth2/authorize",
      "/api/auth/oauth2/token",
      "/api/auth/oauth2/userinfo",
      "/api/auth/oauth2/introspect",
      "/api/auth/oauth2/revoke",
      "/api/auth/oauth2/end-session",
      "/api/auth/oauth2/end-session/confirm",
      "/api/auth/jwks",
      "/api/auth/.well-known/openid-configuration",
    ])
      expect(isPublicAuthPath(path), path).toBe(true);
  });
  it("allows the login flows used by the login and settings pages", () => {
    for (const path of [
      "/api/auth/sign-in/social",
      "/api/auth/link-social",
      "/api/auth/sign-out",
      "/api/auth/callback/discord",
      "/api/auth/miauth/start",
      "/api/auth/miauth/callback",
      "/api/auth/mastodon/start",
      "/api/auth/mastodon/callback",
      "/api/auth/dev/login",
    ])
      expect(isPublicAuthPath(path), path).toBe(true);
  });
  it("rejects endpoints replaced by the account API", () => {
    for (const path of [
      "/api/auth/update-user",
      "/api/auth/unlink-account",
      "/api/auth/delete-user",
      "/api/auth/change-email",
      "/api/auth/get-access-token",
      "/api/auth/account-info",
      "/api/auth/oauth2/update-client",
      "/api/auth/oauth2/create-client",
    ])
      expect(isPublicAuthPath(path), path).toBe(false);
  });
  it("rejects nested or traversing paths around an allowed endpoint", () => {
    for (const path of [
      "/api/auth/callback/discord/extra",
      "/api/auth/callback/",
      "/api/auth/jwks/../update-user",
      "/api/auth/oauth2/token/extra",
    ])
      expect(isPublicAuthPath(path), path).toBe(false);
  });
});
