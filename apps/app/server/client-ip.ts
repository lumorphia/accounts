import { isIP } from "node:net";
import type { FastifyRequest } from "fastify";

/**
 * レート制限とセッション記録に使う利用者の IP (lumorphia/prismtone#102)。
 *
 * 通常は Fastify の req.ip (trustProxy: true で X-Forwarded-For の先頭) でよいが、Cloudflare を
 * 前に置くと Caddy が見る接続元は Cloudflare のエッジになり、全員が数個の IP に束ねられてしまう。
 * Cloudflare は本当の接続元を CF-Connecting-IP に入れるので、CLIENT_IP_HEADER でその名前を
 * 指定したときだけそちらを信じる。VPS へ直接届く経路が残っていると偽装できるので、有効にするのは
 * 80/443 を Cloudflare の IP だけに絞ったあと (lumorphia/prismtone の docs/runbook/cloudflare.md)。
 */
export function clientIp(req: FastifyRequest, header: string | undefined): string {
  if (!header) return req.ip;
  const value = req.headers[header.toLowerCase()];
  if (typeof value !== "string") return req.ip;
  const ip = value.trim();
  return isIP(ip) ? ip : req.ip;
}
