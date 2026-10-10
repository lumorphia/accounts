import { lookup } from "node:dns/promises";
import { request } from "node:https";
import { AVATAR_MAX_INPUT_BYTES } from "@lumorphia/media";
import { isPrivateAddress, normalizeHost } from "./miauth-host.ts";
import { DomainError } from "../plugins/errors.ts";

const mimes = new Set(["image/png", "image/jpeg", "image/webp"]);
const REDIRECTS = new Set([301, 302, 303, 307, 308]);
/** 転送をたどる回数。misskey.io のアイコンは画像のプロキシから配信元へ 1 回移る */
const MAX_REDIRECTS = 3;

/**
 * 連携先の画像を取得する。接続先を検証済みの IP に固定する。転送は MAX_REDIRECTS 回までたどり、
 * 転送先ごとに URL の形と DNS の答え (私的なアドレスでないか) を確かめ直す。
 */
export function parseRemoteAvatarUrl(input: string): { url: URL; host: string } {
  let url: URL;
  let host: string;
  try {
    url = new URL(input);
    if (url.protocol !== "https:" || url.port || url.username || url.password)
      throw new Error("invalid URL");
    host = normalizeHost(url.hostname);
  } catch {
    throw new DomainError("validation", "image_unavailable");
  }
  return { url, host };
}

export async function readRemoteAvatar(
  input: string,
  redirects = 0,
): Promise<{ bytes: Uint8Array; mime: string }> {
  const { url, host } = parseRemoteAvatarUrl(input);
  let addresses: { address: string; family: number }[];
  try {
    addresses = await lookup(host, { all: true });
    if (!addresses.length || addresses.some((entry) => isPrivateAddress(entry.address)))
      throw new Error("private address");
  } catch {
    throw new DomainError("validation", "image_unavailable");
  }
  const chosen = addresses[0]!;
  let next: string | null = null;
  try {
    const image = await new Promise<{ bytes: Uint8Array; mime: string } | null>(
      (resolve, reject) => {
        const req = request(
          url,
          {
            method: "GET",
            timeout: 10_000,
            family: chosen.family,
            lookup: (_hostname, _options, callback) =>
              callback(null, chosen.address, chosen.family),
          },
          async (res) => {
            try {
              const location = res.headers.location;
              if (REDIRECTS.has(res.statusCode ?? 0) && typeof location === "string") {
                next = new URL(location, url).toString();
                res.resume();
                resolve(null);
                return;
              }
              if (res.statusCode !== 200) throw new DomainError("validation", "image_unavailable");
              const mime = String(res.headers["content-type"] ?? "")
                .split(";")[0]!
                .trim();
              if (!mimes.has(mime)) throw new DomainError("validation", "unsupported_format");
              if (Number(res.headers["content-length"] ?? 0) > AVATAR_MAX_INPUT_BYTES)
                throw new DomainError("validation", "too_large");
              const chunks: Buffer[] = [];
              let size = 0;
              for await (const chunk of res) {
                const bytes = Buffer.from(chunk);
                size += bytes.length;
                if (size > AVATAR_MAX_INPUT_BYTES) throw new DomainError("validation", "too_large");
                chunks.push(bytes);
              }
              resolve({ bytes: Buffer.concat(chunks), mime });
            } catch (error) {
              reject(error);
              req.destroy();
            }
          },
        );
        req.on("timeout", () => req.destroy(new Error("timeout")));
        req.on("error", reject);
        req.end();
      },
    );
    if (image) return image;
  } catch (error) {
    if (error instanceof DomainError) throw error;
    throw new DomainError("validation", "image_unavailable");
  }
  if (!next || redirects >= MAX_REDIRECTS) throw new DomainError("validation", "image_unavailable");
  return readRemoteAvatar(next, redirects + 1);
}
