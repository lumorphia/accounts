import { readFileSync } from "node:fs";

/**
 * E2E の TLS (ADR-0002)。発行元のクライアントは https の redirect URI しか登録できないので、E2E では Fastify が
 * 直接 https で待ち受ける (playwright.config.ts が DEV_TLS_* を渡す)。証明書は scripts/dev-certs.sh が .data/tls/ に作る。
 * 開発サーバー (Vite) は http のままで、前に置いた Caddy が https を受ける (docker/Caddyfile.dev)。
 * 本番は Caddy が TLS を受けるので、DEV_TLS_* が設定されていても使わない
 */
export function devTlsOptions(
  env: Record<string, string | undefined>,
): { cert: Buffer; key: Buffer } | null {
  if (env.NODE_ENV === "production") return null;
  if (!env.DEV_TLS_CERT || !env.DEV_TLS_KEY) return null;
  return { cert: readFileSync(env.DEV_TLS_CERT), key: readFileSync(env.DEV_TLS_KEY) };
}
