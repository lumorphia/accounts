# 引き継ぎ: A1.2 (OIDC の発行元)

2026-10-07 時点。A1.1 は完了。A1.2a (PR #6) と A1.2b (PR #7) は Rebase and merge で develop に取り込み済み。A1.2c は `feat/a1-2c-oidc-key-rotation` で署名鍵の更新を確認した。

## できたこと

- A1.2a: PostgreSQL の OIDC スキーマ、discovery・JWKS、PKCE S256、自社クライアントの登録スクリプト、scope ごとの claim、サーバー間の入口。
- A1.2b: 署名付きの認可要求をログイン・初回設定後に再開する。初回設定は最新の DB の状態で判断する。
- A1.2c: 90 日の署名鍵更新、7 日の旧公開鍵保持、再起動後の継続利用を PostgreSQL の結合テストで確認した。既存の設定と実装が要件を満たすため、本体の変更は無い。
- Chromium で Discord・Google・X・MiAuth・Mastodon・開発用ログイン・SSO から HTTPS のサービス側 callback まで進む。認可コードの交換、ID トークンの検証、UserInfo も確かめる。
- TDD の red は戻り先の単体テストと初回設定を経由する DB テストで確認した。

確認: lint・format:check・typecheck、単体と DB テスト 179 件。画面の変更は無く、既存の E2E 全体 19 件は前段の PR #7 で成功。

## 次に行うこと

1. A1.2c の CI が緑になってから develop に Rebase and merge。
2. end-session と back-channel logout の配送を結合テストで確かめる。公開アドレスの検査を守ったまま、テストの配送先を差し替える方法を決める。
3. platform に `@lumorphia/auth-client` を作る。サービス側の Better Auth `generic-oauth` とつなぎ、ログイン・claim・ログアウトの受け口を用意する。

claim の `legacy_pending` は A1.5 の台帳ができるまで空の配列。退会の知らせは A1.4 で専用の仕組みを作り、back-channel logout と共用しない。詳しい手順は [runbook/oidc.md](runbook/oidc.md)。
