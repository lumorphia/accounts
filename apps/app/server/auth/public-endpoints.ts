/**
 * Better Auth の HTTP の口のうち、外に開くものだけの許可リスト (GHSA-fmv4-g5ch-58m6)。
 *
 * Better Auth は update-user・unlink-account・クライアント管理などを標準で開く。これらは
 * `/api/me/*` のドメイン API と運営者のスクリプトで置き換えているので、開いたままだと検証を
 * 迂回される。閉じる口を並べると、版上げで増えた口が黙って開くので、使う口だけを並べる。
 * サーバー内からの `auth.api.*` の呼び出しはこのリストに関係しない。
 */
const PUBLIC_AUTH_PATHS: readonly RegExp[] = [
  // OIDC の発行元としてサービスが呼ぶ
  /^\/oauth2\/(authorize|token|userinfo|introspect|revoke|end-session|end-session\/confirm)$/,
  /^\/jwks$/,
  /^\/\.well-known\/openid-configuration$/,
  // ログイン・連携・ログアウト (login.tsx、settings.tsx)
  /^\/sign-in\/social$/,
  /^\/link-social$/,
  /^\/sign-out$/,
  /^\/callback\/[a-z0-9-]+$/,
  /^\/(miauth|mastodon)\/(start|callback)$/,
  // 開発用ログイン。production では plugin 自体を載せない (auth.ts)
  /^\/dev\/login$/,
];

const PREFIX = "/api/auth";

export function isPublicAuthPath(pathname: string): boolean {
  if (!pathname.startsWith(`${PREFIX}/`)) return false;
  const rest = pathname.slice(PREFIX.length);
  if (rest.split("/").some((segment) => segment === "." || segment === "..")) return false;
  return PUBLIC_AUTH_PATHS.some((pattern) => pattern.test(rest));
}
