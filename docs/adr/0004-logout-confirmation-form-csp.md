# ADR-0004: OIDC のログアウト確認ページで登録済みの戻り先を form-action に足す

| 項目     | 内容       |
| -------- | ---------- |
| Status   | Accepted   |
| Date     | 2026-10-07 |
| Deciders | t1nyb0x    |

## Context

OIDC の end-session に ID トークンの hint が無い場合など、Better Auth は確認フォームを返す。そのページには provider 自身の CSP (`default-src 'none'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'`) が付く。

Chromium はフォーム POST のリダイレクト先も form-action で確かめる。確認後に登録済みのサービスへ戻るとき、`'self'` だけではリダイレクトが遮られる。A1.2d のブラウザ E2E で確認した。

## Decision

- `/api/auth/oauth2/end-session` の HTML 応答だけ、要求の `post_logout_redirect_uri` が有効なクライアントに登録済みなら、そのオリジンを form-action に足す。
- 有効とは `disabled` ではなく `enable_end_session` が有効なこと。戻り先は登録値と完全一致で確かめる。`client_id` が指定された場合はそのクライアントの登録だけを見る。
- provider が返す最終のヘッダを onSend で調整する。他の CSP directive と通常ページの制限は変えない。
- 実際に戻せるかは provider が hint・クライアント・署名付きの確認状態を検証して決める。CSP の許可だけではリダイレクトしない。
- 確認フォームの POST は同一 Origin のまま。CSRF の Origin 確認からは外さない。

## Consequences

- hint が無い場合も、ブラウザで確認してから登録済みのサービスへ戻れる。
- 確認ページの応答にクライアント登録の DB 読み取りが加わる。
- テストでは、登録済みの URI だけが許可されること、無効なクライアントと通常ページでは許可されないこと、Chromium で CSP 違反なく確認できることを押さえる。
