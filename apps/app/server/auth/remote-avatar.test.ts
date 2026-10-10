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

type Reply = { statusCode: number; mime?: string; bytes?: Uint8Array; location?: string };

/** 呼ばれた順に返す。転送 (3xx) のあとの取得を試すため */
function respondInOrder(...replies: Reply[]) {
  let call = 0;
  https.mockImplementation(((_url: URL, _options: object, callback: (res: Readable) => void) => {
    const reply = replies[Math.min(call++, replies.length - 1)]!;
    const req = new EventEmitter() as EventEmitter & { end: () => void; destroy: () => void };
    req.destroy = vi.fn();
    req.end = () => {
      const res = Readable.from([reply.bytes ?? new Uint8Array([1])]) as Readable & {
        statusCode: number;
        headers: Record<string, string>;
        resume: () => Readable;
      };
      res.statusCode = reply.statusCode;
      res.headers = {
        ...(reply.mime ? { "content-type": reply.mime } : {}),
        ...(reply.location ? { location: reply.location } : {}),
      };
      callback(res);
    };
    return req;
  }) as typeof request);
}

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

  it("rejects a redirect without a location", async () => {
    respond(302, "image/png", new Uint8Array([1]));
    await expect(readRemoteAvatar("https://cdn.example.com/a.png")).rejects.toThrow(
      "image_unavailable",
    );
  });

  // misskey.io のアイコンは proxy.misskeyusercontent.jp から media.misskeyusercontent.jp へ 307 で移る
  it("follows a redirect to another public HTTPS host", async () => {
    respondInOrder(
      { statusCode: 307, location: "https://media.example.com/io/a.webp" },
      { statusCode: 200, mime: "image/webp", bytes: new Uint8Array([7, 8]) },
    );
    const image = await readRemoteAvatar("https://proxy.example.com/avatar.webp?url=x");
    expect(image.mime).toBe("image/webp");
    expect([...image.bytes]).toEqual([7, 8]);
  });

  it("checks the redirect target's address again before connecting", async () => {
    respondInOrder(
      { statusCode: 307, location: "https://media.example.com/io/a.webp" },
      { statusCode: 200, mime: "image/webp" },
    );
    await readRemoteAvatar("https://proxy.example.com/avatar.webp");
    expect(dns.mock.calls.map((c) => c[0])).toEqual(["proxy.example.com", "media.example.com"]);
  });

  it("rejects a redirect to a private address", async () => {
    dns
      .mockResolvedValueOnce([{ address: "8.8.8.8", family: 4 }] as never)
      .mockResolvedValueOnce([{ address: "10.0.0.1", family: 4 }] as never);
    respondInOrder(
      { statusCode: 307, location: "https://internal.example.com/a.webp" },
      { statusCode: 200, mime: "image/webp" },
    );
    await expect(readRemoteAvatar("https://proxy.example.com/a.webp")).rejects.toThrow(
      "image_unavailable",
    );
    expect(https).toHaveBeenCalledTimes(1);
  });

  it("rejects a redirect to plain HTTP", async () => {
    respondInOrder({ statusCode: 302, location: "http://media.example.com/a.webp" });
    await expect(readRemoteAvatar("https://proxy.example.com/a.webp")).rejects.toThrow(
      "image_unavailable",
    );
    expect(https).toHaveBeenCalledTimes(1);
  });

  it("stops after three redirects", async () => {
    respondInOrder({ statusCode: 302, location: "https://cdn.example.com/again.png" });
    await expect(readRemoteAvatar("https://cdn.example.com/a.png")).rejects.toThrow(
      "image_unavailable",
    );
    expect(https).toHaveBeenCalledTimes(4);
  });

  it("rejects unexpected content types", async () => {
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
