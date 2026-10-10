import { describe, expect, it } from "vitest";
import type { Database } from "@lumorphia-accounts/db";
import { loadEnv } from "../env.ts";
import { createAuth } from "./auth.ts";

const db = {} as Database;
const env = () =>
  loadEnv({
    NODE_ENV: "test",
    DATABASE_URL: "postgres://unused/unused",
    AUTH_SECRET: "test-secret-test-secret-test-secret-1234",
    AUTH_BASE_URL: "https://accounts.lumorphia.test:3443",
    AUTH_DISCORD_ID: "test-discord-id",
    AUTH_DISCORD_SECRET: "test-discord-secret",
  });

describe("social auth configuration", () => {
  it("enables the OIDC provider with signed ID tokens", () => {
    const auth = createAuth({ db, env: env() });
    const ids = auth.options.plugins?.map((plugin) => plugin.id);
    expect(ids).toContain("oauth-provider");
    expect(ids).toContain("jwt");
    expect(auth.options.disabledPaths).toContain("/token");
  });
  it("does not merge users by matching email", () => {
    const auth = createAuth({ db, env: env() });
    expect(auth.options.account?.accountLinking?.trustedProviders).toEqual([]);
  });

  it("uses the Lumorphia cookie prefix and login error page", () => {
    const auth = createAuth({ db, env: env() });
    expect(auth.options.advanced?.cookiePrefix).toBe("lumorphia");
    expect(auth.options.onAPIError?.errorURL).toBe("https://accounts.lumorphia.test:3443/login");
  });

  it("asks Discord for consent on every login", () => {
    const auth = createAuth({ db, env: env() });
    const discord = auth.options.socialProviders?.discord as { prompt?: string } | undefined;
    expect(discord?.prompt).toBe("consent");
  });
});
