# OIDC の発行元

Better Auth / oauth-provider は 1.7.7 に固定する (ADR-0003)。discovery は `/api/auth/.well-known/openid-configuration`、JWKS は `/api/auth/jwks`。認可コード + PKCE S256 を使い、refresh token と動的登録は有効にしない。

## 自社クライアントを登録する

運営者の active アカウント (`users.role = 'admin'`) でログインし、そのセッションの Cookie を `OIDC_ADMIN_COOKIE` 環境変数に設定する。Cookie をコマンドの引数・ログ・コミットに残さない。スクリプトは DB に直接接続するので、発行元と同じ `DATABASE_URL`、`AUTH_SECRET`、`AUTH_BASE_URL` で動かす。

設定ファイルの例 (秘密は含まない):

```json
{
  "service": "prismtone",
  "redirectUri": "https://prismtone.lumorphia.com/api/auth/callback/lumorphia",
  "postLogoutRedirectUri": "https://prismtone.lumorphia.com/",
  "backchannelLogoutUri": "https://prismtone.lumorphia.com/api/lumorphia/backchannel-logout",
  "lifecycleUri": "https://prismtone.lumorphia.com/api/lumorphia/account-events"
}
```

```sh
node --env-file-if-exists=.env scripts/oidc-client.ts --config /path/to/client.json --output /path/to/credentials.json
```

出力は秘密を含むので、権限 0600 の新規ファイルに保存する。既存ファイルを上書きしない。サービスの環境変数には `client_id` と `client_secret` を設定する。運営者のセッションが無い場合・一般利用者の場合は登録できない。

- redirect / logout URI は HTTPS のホスト名に限る。開発も `*.lumorphia.test` を使う
- `prismtone` のみ `lumorphia:identities` と移行完了通知用の `lumorphia:legacy` を登録する。全サービスに `lumorphia:characters` を登録する。`scenote` と `facetia` は `openid profile email lumorphia:characters`
- サービスは `metadata.lumorphia_service` で見分ける (ADR-0012)。登録スクリプトが自動で入れる。`client_name` は表示名なので、変えても通知・失効・権限に影響しない。手で DB にクライアントを足すときも `lumorphia_service` を必ず入れる
- 自社クライアントは同意画面を省略し、end-session を有効にする
- DB に保存するクライアントの秘密と署名の秘密鍵は Better Auth が保護する

## claim

`profile` scope では `https://lumorphia.com/handle` と `https://lumorphia.com/legacy_pending` を ID トークンと UserInfo に載せる。旧アカウントの台帳と現在の連携が一致する引き継ぎ待ちのサービスを `legacy_pending` に載せる。移行完了後は最新の UserInfo から取り除く。詳しくは [台帳 runbook](legacy-ledger.md)。

`lumorphia:identities` scope を登録・要求したクライアントだけに `https://lumorphia.com/identities` (provider / id の配列) を渡す。開発用ログインの組は含めない。claim の生成には最新の利用者状態を確認し、active 以外には発行しない。

`lumorphia:characters` はキャラクター一覧 API の読み取り権限。キャラクターや確認トークンを ID トークン / UserInfo に載せない。使い方は [キャラクター runbook](characters.md)。

## ログインと初回設定から戻る

認可要求でログインが必要な場合、発行元が `/login` に署名付きの query を付けて戻す。ログイン画面はその query を保った `/api/auth/oauth2/authorize` を callback に指定する。Discord・Google・X・MiAuth・Mastodon と開発用ログインで同じ戻り方を使う。

初回設定前の利用者は発行元の `postLogin` で `/welcome` に進む。設定が済んだら署名付きの query で認可を再開する。利用者の状態は DB から読み直す。通常の `next` は同一サイトの相対パスに限る。

`e2e/oidc.spec.ts` は HTTPS のサービス側 callback を立て、5 種のログイン・開発用ログイン・ログイン済みの SSO を Chromium で確認する。認可コードの交換と UserInfo は同じ DB を使う Fastify の `inject` で確かめ、ID トークンは JWKS から署名・issuer・audience・nonce・handle を検証する。サービス側の Better Auth `generic-oauth` との接続は `@lumorphia/auth-client` の作業で追加する。

## サーバー間の入口

`POST /api/auth/oauth2/token`、`introspect`、`revoke` は Origin を要求しない。OAuth のクライアント認証で確認する。ほかの変更系 API は引き続き同一 Origin を要求する。

## 署名の鍵

EdDSA (Ed25519)。秘密鍵は `AUTH_SECRET` で保護され、DB に暗号化して保存する。署名鍵の有効期間は作成から 90 日。期限に達した後、最初のトークン署名で新しい鍵を作る。JWKS の読み取りだけでは鍵は更新されない。

古い公開鍵は署名の有効期限から 7 日間 JWKS に残り、新旧の鍵で署名された有効な ID トークンを検証できる。7 日の猶予期間に達すると JWKS から外れるが、DB の鍵の行は物理削除されない。アプリを再起動しても同じ DB と `AUTH_SECRET` なら保存済みの鍵を使う。

`apps/app/server/auth/oidc-key-rotation.db.test.ts` では Date だけを進め、PostgreSQL と実際の認可コード交換で、90 日の更新境界・7 日の公開境界・秘密鍵を公開しないこと・再起動後の継続利用を確かめる。更新間隔と保持期間を一時的に短くした場合にテストが失敗することも確認済み。

## ログアウト

サービスは discovery の `end_session_endpoint` にブラウザを向け、`id_token_hint`・登録済みの `post_logout_redirect_uri`・`state` を渡す。hint と現在のセッションが一致すればそのセッションを終了してサービスに戻す。hint が無い場合や別セッションの hint は確認フォームを経由する。確認フォームの POST は同一 Origin を要求する。

確認フォームから登録済みのサービスへ戻るリダイレクトは Chromium の form-action 制限も受ける。確認ページだけ、要求の戻り先 URI が有効なクライアントに登録されていれば、そのオリジンを CSP に足す (ADR-0004)。provider の他の CSP と、通常ページの form-action は保持する。

セッションを終了すると、そこで使ったサービスの `backchannel_logout_uri` に署名付きの Logout Token を POST する。アカウント側の通常の sign-out でも配送する。session に結び付いた access token は無効になり、introspect と UserInfo でも使えなくなる。

- Logout Token は `typ: logout+jwt`、EdDSA の署名。`iss`・サービスの `aud`・`sub`・`sid`・`iat`・`exp`・`jti` と `http://schemas.openid.net/event/backchannel-logout` の event を持つ。`nonce` は持たず、有効期間は120秒。
- 各サービスへの配送は1回。受信先のエラーで他のサービスへの配送やログアウトを止めない。再送する仕組みは持たないので、退会の知らせとは共用しない。
- 受信先の URL は登録時に HTTPS と公開ホスト名を要求する。テストのためにこの検査を弱めない。
- end-session は署名検証のため、発行元自身の JWKS を HTTP で取得する。実行環境から `AUTH_BASE_URL` の JWKS に到達できる必要がある。

`oidc-logout.db.test.ts` では登録済みの配送先だけをローカル HTTP 受信サーバーへ向け、DB・JWT の署名検証・通知の内容・失敗時の継続を確認する。`e2e/oidc-network.ts` は E2E の発行元プロセスだけに preload し、既知の JWKS と通知先の通信を手元の TLS サーバーへ向ける。手元 CA とホスト名による証明書の検証は有効なまま。ブラウザ E2E は hint 付きの logout と、hint 無しの確認フォームの両方で、CSP 違反なくサービスへ戻り Cookie のセッションが終了することを確認する。

サービス側のセッションを消す受け口と Logout Token の検証は、次の `@lumorphia/auth-client` で実装する。

退会と復旧の通知先は `lifecycleUri`。登録と再送の手順は [退会 runbook](account-deletion.md)。
