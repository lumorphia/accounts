import { describe, expect, it } from "vitest";
import { isPrivateAddress, MiAuthHostError, normalizeHost } from "./miauth-host.ts";

describe("normalizeHost", () => {
  it("normalizes case and trailing dot", () => {
    expect(normalizeHost(" Misskey.IO. ")).toBe("misskey.io");
  });
  it("converts IDN to punycode", () => {
    expect(normalizeHost("例え.jp")).toBe("xn--r8jz45g.jp");
  });
  it.each([
    "https://misskey.io",
    "misskey.io/",
    "misskey.io:443",
    "user@misskey.io",
    "127.0.0.1",
    "::1",
    "localhost",
    "",
    "a b.io",
  ])("rejects %s", (input) => {
    expect(() => normalizeHost(input)).toThrow(MiAuthHostError);
  });
});

describe("isPrivateAddress", () => {
  it.each([
    "127.0.0.1",
    "10.1.2.3",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.1",
    "169.254.1.1",
    "0.0.0.0",
    "100.64.0.1",
    "224.0.0.1",
    "::1",
    "fe80::1",
    "fd00::1",
    "::ffff:10.0.0.1",
  ])("%s is private", (ip) => expect(isPrivateAddress(ip)).toBe(true));
  it.each(["8.8.8.8", "172.32.0.1", "1.1.1.1", "2606:4700::1111", "::ffff:8.8.8.8"])(
    "%s is public",
    (ip) => expect(isPrivateAddress(ip)).toBe(false),
  );
  it("treats garbage as private", () => expect(isPrivateAddress("nope")).toBe(true));
});

describe("assertPublicHost", async () => {
  const { assertPublicHost } = await import("./miauth-host.ts");
  it("rejects blocked hosts and their subdomains", async () => {
    await expect(
      assertPublicHost("bad.example", { blockedHosts: ["bad.example"] }),
    ).rejects.toMatchObject({ reason: "blocked" });
    await expect(
      assertPublicHost("sub.bad.example", { blockedHosts: ["bad.example"] }),
    ).rejects.toMatchObject({ reason: "blocked" });
  });
  it("rejects hosts that resolve to private addresses", async () => {
    await expect(assertPublicHost("localhost", { blockedHosts: [] })).rejects.toMatchObject({
      reason: "private_address",
    });
  });
  // getaddrinfo は libuv のスレッドプールで動き、並列の画像処理 (sharp) に待たされることがある
  it("rejects unresolvable hosts", { timeout: 20_000 }, async () => {
    await expect(
      assertPublicHost("does-not-exist.invalid", { blockedHosts: [] }),
    ).rejects.toMatchObject({ reason: "unresolvable" });
  });
});
