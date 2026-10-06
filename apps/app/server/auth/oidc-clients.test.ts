import { describe, expect, it } from "vitest";
import { serviceClientMetadata } from "./oidc-clients.ts";

describe("serviceClientMetadata", () => {
  it("reserves identity claims for the migration client", () => {
    expect(
      serviceClientMetadata({
        service: "prismtone",
        redirectUri: "https://prismtone.lumorphia.test/api/auth/callback/lumorphia",
      }).scope,
    ).toContain("lumorphia:identities");
    expect(
      serviceClientMetadata({
        service: "scenote",
        redirectUri: "https://scenote.lumorphia.test/api/auth/callback/lumorphia",
      }).scope,
    ).not.toContain("lumorphia:identities");
  });

  it("rejects web redirect URLs outside HTTPS hosts", () => {
    for (const redirectUri of [
      "http://prismtone.example/callback",
      "https://localhost/callback",
      "https://127.0.0.1/callback",
      "https://user:password@prismtone.example/callback",
    ]) {
      expect(() => serviceClientMetadata({ service: "prismtone", redirectUri })).toThrow();
    }
  });
});
