/**
 * Content-Security-Policy の組み立て。lumorphia/prismtone の csp.ts (RM-28) を、アカウントに要るものだけにした。
 * - script-src: 自分と、SSR が出すインラインスクリプトのリクエストごとの nonce だけ。eval も WebAssembly も使わない
 * - img-src: 自分、アイコンの配信元、data:、連携アカウントのアイコン (Misskey / Discord / Google の CDN は任意ホスト
 *   なので https:)。画像は script より危険が小さいので受け入れる
 * - connect-src: 自分と Sentry
 * - style-src: React の style 属性のために 'unsafe-inline'
 */
export type CspDirectives = Record<string, string[]>;

export type CspInput = {
  nonce: string;
  /** PUBLIC_IMAGE_BASE_URL。相対 (同一オリジン) なら足さない */
  imageBaseUrl: string;
  /** ブラウザ SDK の送信先。未設定なら足さない */
  sentryDsn: string | null;
  /** OAuth の偽装サーバー。開発・E2E でだけ渡す。連携アカウントのアイコンを http から出すので img-src に足す */
  oauthMockOrigin?: string | null | undefined;
};

export const CSP_REPORT_PATH = "/api/csp-report";
/** Fastify → SSR (entry.server) に nonce を渡すリクエストヘッダ。外から来た値は security plugin が上書きする */
export const CSP_NONCE_HEADER = "x-csp-nonce";

/** 絶対 URL ならオリジンを返す。相対や不正な値は null */
function originOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:" ? u.origin : null;
  } catch {
    return null;
  }
}

function unique(values: (string | null)[]): string[] {
  return [...new Set(values.filter((v): v is string => v !== null))];
}

export function buildCspDirectives(input: CspInput): CspDirectives {
  return {
    "default-src": ["'self'"],
    "script-src": ["'self'", `'nonce-${input.nonce}'`],
    "style-src": ["'self'", "'unsafe-inline'"],
    "img-src": unique([
      "'self'",
      originOf(input.imageBaseUrl),
      "data:",
      "https:",
      originOf(input.oauthMockOrigin),
    ]),
    "font-src": ["'self'", "data:"],
    "connect-src": unique(["'self'", originOf(input.sentryDsn)]),
    "frame-ancestors": ["'none'"],
    "form-action": ["'self'"],
    "base-uri": ["'self'"],
    "object-src": ["'none'"],
    "report-uri": [CSP_REPORT_PATH],
  };
}

export function serializeCsp(directives: CspDirectives): string {
  return Object.entries(directives)
    .map(([name, values]) => `${name} ${values.join(" ")}`)
    .join("; ");
}
