import { describe, expect, it } from "vitest";
import { clientIp } from "./client-ip.ts";

const req = (headers: Record<string, string | string[] | undefined>, ip = "10.0.0.1") =>
  ({ ip, headers }) as never;

describe("clientIp", () => {
  it("returns req.ip when no header is configured", () => {
    expect(clientIp(req({ "cf-connecting-ip": "203.0.113.9" }), undefined)).toBe("10.0.0.1");
  });

  it("returns the configured header when present", () => {
    expect(clientIp(req({ "cf-connecting-ip": "203.0.113.9" }), "cf-connecting-ip")).toBe(
      "203.0.113.9",
    );
  });

  it("matches the header name case-insensitively", () => {
    expect(clientIp(req({ "cf-connecting-ip": "203.0.113.9" }), "CF-Connecting-IP")).toBe(
      "203.0.113.9",
    );
  });

  it("falls back to req.ip when the configured header is absent", () => {
    expect(clientIp(req({}), "cf-connecting-ip")).toBe("10.0.0.1");
  });

  it("falls back to req.ip when the header is not a single valid IP", () => {
    expect(clientIp(req({ "cf-connecting-ip": "not-an-ip" }), "cf-connecting-ip")).toBe("10.0.0.1");
    expect(clientIp(req({ "cf-connecting-ip": ["1.1.1.1", "2.2.2.2"] }), "cf-connecting-ip")).toBe(
      "10.0.0.1",
    );
  });

  it("accepts an IPv6 address", () => {
    expect(clientIp(req({ "cf-connecting-ip": "2001:db8::1" }), "cf-connecting-ip")).toBe(
      "2001:db8::1",
    );
  });
});
