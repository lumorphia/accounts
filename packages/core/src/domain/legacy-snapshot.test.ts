import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { parseLegacySnapshot } from "./legacy-ledger.ts";
const snapshot = (providerId = "discord", accountId = "test-provider-id") => ({
  service: "prismtone",
  accounts: [
    { legacyUserId: randomUUID(), handle: "test_old", identities: [{ providerId, accountId }] },
  ],
});
describe("legacy snapshot validation", () => {
  it("rejects control characters in provider identities", () => {
    expect(() => parseLegacySnapshot(snapshot("discord", "test-id\nother"))).toThrow();
  });
  it("requires the host as part of a federated provider identity", () => {
    expect(() => parseLegacySnapshot(snapshot("misskey", "test-user-id"))).toThrow();
    expect(() => parseLegacySnapshot(snapshot("mastodon", "test-user-id"))).toThrow();
  });
});
