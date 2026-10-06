import { describe, expect, it } from "vitest";
import { parseRemoteAvatarUrl } from "./remote-avatar.ts";

describe("remote avatar URL", () => {
  it("accepts an HTTPS hostname on the standard port", () => {
    expect(parseRemoteAvatarUrl("https://cdn.example.com/icon.png").host).toBe("cdn.example.com");
  });
  it("rejects non HTTPS, local IPs, credentials and custom ports", () => {
    for (const input of [
      "http://cdn.example.com/icon.png",
      "https://127.0.0.1/icon.png",
      "https://a:b@cdn.example.com/icon.png",
      "https://cdn.example.com:8443/icon.png",
    ]) {
      expect(() => parseRemoteAvatarUrl(input)).toThrow();
    }
  });
});
