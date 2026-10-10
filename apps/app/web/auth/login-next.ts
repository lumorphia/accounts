/** 署名付きの認可要求は発行元に戻して検証する。通常の戻り先は同一サイトに限る。 */
export function loginNext(params: URLSearchParams): string {
  if (params.has("sig") && params.has("client_id"))
    return `/api/auth/oauth2/authorize?${params.toString()}`;
  const next = params.get("next");
  if (!next?.startsWith("/")) return "/";
  const base = new URL("https://accounts.lumorphia.invalid");
  try {
    const url = new URL(next, base);
    if (url.origin !== base.origin || url.pathname.startsWith("//")) return "/";
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return "/";
  }
}

/** 戻り先がサービスへの認可なら、サービスのログインの途中。時間が経つとサービス側でやり直しになる。 */
export function isServiceLogin(next: string): boolean {
  return next.startsWith("/api/auth/oauth2/authorize?");
}
