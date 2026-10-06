# 引き継ぎ: A1.2 (OIDC の発行元)

2026-10-07 時点。A1.1 は完了。A1.2a は PR #6 (`feat/a1-2a-oidc-provider`) で、確認時に check・e2e・security が成功、未マージ。A1.2b はその先の `feat/a1-2b-oidc-flow` で作業した。

## できたこと

- A1.2a: PostgreSQL の OIDC スキーマ、discovery・JWKS、PKCE S256、自社クライアントの登録スクリプト、scope ごとの claim、サーバー間の入口。
- A1.2b: 署名付きの認可要求をログイン・初回設定後に再開する。初回設定は最新の DB の状態で判断する。
- Chromium で Discord・Google・X・MiAuth・Mastodon・開発用ログイン・SSO から HTTPS のサービス側 callback まで進む。認可コードの交換、ID トークンの検証、UserInfo も確かめる。
- TDD の red は戻り先の単体テストと初回設定を経由する DB テストで確認した。

確認: lint・format:check・typecheck、単体と DB テスト 172 件、E2E 全体 19 件。

## 次に行うこと

1. A1.2a と A1.2b の順に develop へ入れる。CI が緑になってから Rebase and merge。
2. 鍵の更新と、古い公開鍵が猶予期間中に残ることを DB の結合テストで確かめる。
3. end-session と back-channel logout の配送を結合テストで確かめる。公開アドレスの検査を守ったまま、テストの配送先を差し替える方法を決める。
4. platform に `@lumorphia/auth-client` を作る。サービス側の Better Auth `generic-oauth` とつなぎ、ログイン・claim・ログアウトの受け口を用意する。

claim の `legacy_pending` は A1.5 の台帳ができるまで空の配列。退会の知らせは A1.4 で専用の仕組みを作り、back-channel logout と共用しない。詳しい手順は [runbook/oidc.md](runbook/oidc.md)。
