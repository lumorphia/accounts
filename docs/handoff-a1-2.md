# 引き継ぎ: A1.2 (OIDC の発行元)

2026-10-07 時点。A1.1 は完了。A1.2a〜A1.2c (PR #6・#7・#8) は Rebase and merge で develop に取り込み済み。A1.2d は `feat/a1-2d-oidc-logout` でログアウトと通知配送を確認した。

## できたこと

- A1.2a: PostgreSQL の OIDC スキーマ、discovery・JWKS、PKCE S256、自社クライアントの登録スクリプト、scope ごとの claim、サーバー間の入口。
- A1.2b: 署名付きの認可要求をログイン・初回設定後に再開する。初回設定は最新の DB の状態で判断する。
- A1.2c: 90 日の署名鍵更新、7 日の旧公開鍵保持、再起動後の継続利用を PostgreSQL の結合テストで確認した。既存の設定と実装が要件を満たすため、本体の変更は無い。
- A1.2d: end-session、確認フォーム、back-channel logout の HTTP/TLS 配送、access token の無効化と配送エラー時の継続を確認した。確認後のリダイレクトが CSP に遮られる問題を、登録済みの戻り先だけを許可して解消した (ADR-0004)。
- Chromium で Discord・Google・X・MiAuth・Mastodon・開発用ログイン・SSO から HTTPS のサービス側 callback まで進む。認可コードの交換、ID トークンの検証、UserInfo も確かめる。
- TDD の red は戻り先の単体テストと初回設定を経由する DB テストで確認した。

確認: lint・format:check・typecheck、単体と DB テスト 195 件、E2E 全体 21 件。CSP の修正は DB テストとブラウザ E2E の失敗 (red) を確認してから通した。

## 次に行うこと

1. A1.2d の CI が緑になってから develop に Rebase and merge。
2. platform に `@lumorphia/auth-client` を作る。サービス側の Better Auth `generic-oauth` とつなぎ、ログイン・claim・ログアウトの受け口を用意する。

claim の `legacy_pending` は A1.5 の台帳ができるまで空の配列。退会の知らせは A1.4 で専用の仕組みを作り、back-channel logout と共用しない。詳しい手順は [runbook/oidc.md](runbook/oidc.md)。
