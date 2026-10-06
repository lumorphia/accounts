import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import { lookup } from "node:dns/promises";
import { request } from "node:https";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseRemoteAvatarUrl, readRemoteAvatar } from "./remote-avatar.ts";

vi.mock("node:dns/promises", () => ({ lookup: vi.fn() }));
vi.mock("node:https", () => ({ request: vi.fn() }));

const dns = vi.mocked(lookup);
const https = vi.mocked(request);

function respond(statusCode: number, mime: string, bytes: Uint8Array, length?: number) {
  https.mockImplementation(((_url: URL, options: object, callback: (res: Readable) => void) => {
    const req = new EventEmitter() as EventEmitter & { end: () => void; destroy: () => void };
    req.destroy = vi.fn();
    req.end = () => {
      const res = Readable.from([bytes]) as Readable & {
        statusCode: number;
        headers: Record<string, string>;
      };
      res.statusCode = statusCode;
      res.headers = {
        "content-type": mime,
        ...(length !== undefined ? { "content-length": String(length) } : {}),
      };
      callback(res);
    };
    return req;
  }) as typeof request);
}

beforeEach(() => {
  vi.clearAllMocks();
  dns.mockResolvedValue([{ address: "8.8.8.8", family: 4 }] as never);
});

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

describe("readRemoteAvatar", () => {
  it("fetches an image from the validated public address", async () => {
    respond(200, "image/png; charset=binary", new Uint8Array([1, 2, 3]));
    const image = await readRemoteAvatar("https://cdn.example.com/avatar.png");
    expect(image.mime).toBe("image/png");
    expect([...image.bytes]).toEqual([1, 2, 3]);
    const options = https.mock.calls[0]?.[1];
    expect(options).toMatchObject({ method: "GET", family: 4 });
  });

  it("rejects a private DNS answer before opening a connection", async () => {
    dns.mockResolvedValue([{ address: "127.0.0.1", family: 4 }] as never);
    await expect(readRemoteAvatar("https://cdn.example.com/avatar.png")).rejects.toThrow(
      "image_unavailable",
    );
    expect(https).not.toHaveBeenCalled();
  });

  it("rejects redirects and unexpected content types", async () => {
    respond(302, "image/png", new Uint8Array([1]));
    await expect(readRemoteAvatar("https://cdn.example.com/a.png")).rejects.toThrow(
      "image_unavailable",
    );
    respond(200, "text/html", new Uint8Array([1]));
    await expect(readRemoteAvatar("https://cdn.example.com/a.png")).rejects.toThrow(
      "unsupported_format",
    );
  });

  it("rejects oversized images from the header or streamed bytes", async () => {
    respond(200, "image/png", new Uint8Array([1]), 10_000_000);
    await expect(readRemoteAvatar("https://cdn.example.com/a.png")).rejects.toThrow("too_large");
    respond(200, "image/png", new Uint8Array(10_000_000));
    await expect(readRemoteAvatar("https://cdn.example.com/a.png")).rejects.toThrow("too_large");
  });
});
