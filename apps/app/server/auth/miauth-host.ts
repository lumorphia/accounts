import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

/**
 * MiAuth の接続先 host の検証 (docs/design/07 §3.2, SSRF 対策)。
 * 純粋な形式検証 (normalizeHost) と、DNS を引く検証 (assertPublicHost) を分ける。
 */

export type HostError = "invalid_format" | "blocked" | "private_address" | "unresolvable";

export class MiAuthHostError extends Error {
  readonly reason: HostError;
  constructor(reason: HostError) {
    super(reason);
    this.name = "MiAuthHostError";
    this.reason = reason;
  }
}

const HOSTNAME = /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

/** 入力を小文字・末尾ドット除去・punycode 化した hostname に正規化する。scheme / path / port は拒否。 */
export function normalizeHost(input: string): string {
  const raw = input.trim().toLowerCase().replace(/\.$/, "");
  if (
    raw === "" ||
    raw.includes("/") ||
    raw.includes(":") ||
    raw.includes("@") ||
    raw.includes(" ")
  ) {
    throw new MiAuthHostError("invalid_format");
  }
  let ascii: string;
  try {
    ascii = new URL(`https://${raw}`).hostname;
  } catch {
    throw new MiAuthHostError("invalid_format");
  }
  if (ascii !== raw && !/[^\x00-\x7f]/.test(raw)) throw new MiAuthHostError("invalid_format");
  if (isIP(ascii) || !HOSTNAME.test(ascii)) throw new MiAuthHostError("invalid_format");
  return ascii;
}

export function isPrivateAddress(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) {
    const [a = 0, b = 0] = ip.split(".").map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) ||
      a >= 224
    );
  }
  if (v === 6) {
    const s = ip.toLowerCase();
    if (s === "::1" || s === "::") return true;
    if (s.startsWith("fe80:") || s.startsWith("fc") || s.startsWith("fd")) return true;
    if (s.startsWith("::ffff:")) return isPrivateAddress(s.slice(7));
    return false;
  }
  return true;
}

export type HostPolicy = {
  blockedHosts: readonly string[];
  /** テスト・開発専用。DNS 検証を省き http を許す host:port の一覧。production では無視する */
  devHosts?: readonly string[];
};

/** host が拒否リストになく、解決先がすべて公開アドレスであることを確認する。 */
export async function assertPublicHost(host: string, policy: HostPolicy): Promise<void> {
  if (policy.blockedHosts.some((b) => host === b || host.endsWith(`.${b}`)))
    throw new MiAuthHostError("blocked");
  let addrs: { address: string }[];
  try {
    addrs = await lookup(host, { all: true });
  } catch {
    throw new MiAuthHostError("unresolvable");
  }
  if (addrs.length === 0) throw new MiAuthHostError("unresolvable");
  if (addrs.some((a) => isPrivateAddress(a.address))) throw new MiAuthHostError("private_address");
}
