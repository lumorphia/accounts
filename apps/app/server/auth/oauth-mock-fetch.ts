/**
 * E2E 専用: better-auth のソーシャルプロバイダーが叩く token / userinfo の向き先を、
 * e2e/mock-oauth.ts に差し替える (RM-23)。better-auth は URL を固定で持っていて設定で変えられないので、
 * グローバルの fetch を包む。OAUTH_MOCK_BASE_URL があり、NODE_ENV が production でないときだけ使う
 */
const HOSTS: Record<string, string> = {
  "https://discord.com": "/discord",
  "https://oauth2.googleapis.com": "/google",
  "https://api.x.com": "/x",
};

/** 差し替え先の URL。対象外のホストは null */
export function rewriteOAuthUrl(input: string, mockBaseUrl: string): string | null {
  for (const [origin, prefix] of Object.entries(HOSTS)) {
    if (input.startsWith(`${origin}/`)) {
      return `${mockBaseUrl.replace(/\/$/, "")}${prefix}${input.slice(origin.length)}`;
    }
  }
  return null;
}

let installed = false;

export function installOAuthMockFetch(mockBaseUrl: string): void {
  if (installed) return;
  installed = true;
  const original = globalThis.fetch;
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const rewritten = rewriteOAuthUrl(url, mockBaseUrl);
    if (!rewritten) return original(input, init);
    // Request を渡された場合も URL だけ差し替えて、メソッドとヘッダは保つ
    return typeof input === "string" || input instanceof URL
      ? original(rewritten, init)
      : original(new Request(rewritten, input), init);
  }) as typeof fetch;
}
