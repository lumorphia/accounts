import { z } from "zod";

// 環境変数。A1.0 は土台に要るものだけ。ログイン (AUTH_*) などは段階ごとに足す (docs/plan.md 4.1)
const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3100),
  HOST: z.string().default("0.0.0.0"),
  LOG_LEVEL: z.string().default("info"),
  /** Sentry 監視。DSN は公開値だが、未設定なら SDK を無効にする */
  SENTRY_DSN: z.string().url().optional(),
  SENTRY_ENVIRONMENT: z.string().default("production"),
  DATABASE_URL: z.string().min(1),
  /** アイコンの配信元 (R2 のカスタムドメイン)。A1.1 で使う */
  PUBLIC_IMAGE_BASE_URL: z.string().url().default("https://img.example.invalid"),
  /** /api 全体の IP ごとの上限 (1 分) */
  API_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(120),
  /**
   * Cloudflare などの信頼できるプロキシが接続元 IP を入れるヘッダ名 (例: cf-connecting-ip)。
   * VPS を Cloudflare の IP だけに絞ってから設定する (lumorphia/prismtone#102)
   */
  CLIENT_IP_HEADER: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v ? v.toLowerCase() : undefined)),
  /** E2E 専用: レート制限を全部外す。本番では無視する */
  API_RATE_LIMIT_DISABLED: z
    .enum(["0", "1", "true", "false"])
    .default("0")
    .transform((v) => v === "1" || v === "true"),
  /** CSP を強制せず Report-Only で違反だけ集める (本番の最初の 1 週間用) */
  CSP_REPORT_ONLY: z
    .string()
    .default("0")
    .transform((v) => v === "1" || v === "true"),
  /** E2E 専用: OAuth の偽装サーバー。開発・テストでだけ CSP の img-src に足す */
  OAUTH_MOCK_BASE_URL: z.string().url().optional(),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const missing = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(", ");
    throw new Error(`invalid environment: ${missing}`);
  }
  return parsed.data;
}
