/** 認証後に戻る先を、このサイトの相対パスに限定する。 */
export function localRedirect(input: string): string {
  if (!input.startsWith("/")) return "/";
  const base = new URL("https://accounts.lumorphia.invalid");
  try {
    const url = new URL(input, base);
    return url.origin === base.origin ? `${url.pathname}${url.search}${url.hash}` : "/";
  } catch {
    return "/";
  }
}
