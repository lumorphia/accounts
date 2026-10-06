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
  "backchannelLogoutUri": "https://prismtone.lumorphia.com/api/lumorphia/backchannel-logout"
}
```

```sh
node --env-file-if-exists=.env scripts/oidc-client.ts --config /path/to/client.json --output /path/to/credentials.json
```

出力は秘密を含むので、権限 0600 の新規ファイルに保存する。既存ファイルを上書きしない。サービスの環境変数には `client_id` と `client_secret` を設定する。運営者のセッションが無い場合・一般利用者の場合は登録できない。

- redirect / logout URI は HTTPS のホスト名に限る。開発も `*.lumorphia.test` を使う
- `prismtone` のみ `lumorphia:identities` を登録する。`scenote` と `facetia` は `openid profile email`
- 自社クライアントは同意画面を省略し、end-session を有効にする
- DB に保存するクライアントの秘密と署名の秘密鍵は Better Auth が保護する

## claim

`profile` scope では `https://lumorphia.com/handle` と `https://lumorphia.com/legacy_pending` を ID トークンと UserInfo に載せる。旧アカウントの台帳は A1.5 で作るため、それまでは `legacy_pending` は空の配列。

`lumorphia:identities` scope を登録・要求したクライアントだけに `https://lumorphia.com/identities` (provider / id の配列) を渡す。開発用ログインの組は含めない。claim の生成には最新の利用者状態を確認し、active 以外には発行しない。

## サーバー間の入口

`POST /api/auth/oauth2/token`、`introspect`、`revoke` は Origin を要求しない。OAuth のクライアント認証で確認する。ほかの変更系 API は引き続き同一 Origin を要求する。

## 署名の鍵

EdDSA (Ed25519)。秘密鍵は DB に暗号化して保存する。90 日で自動更新し、失効した公開鍵は 7 日間 JWKS に残す。A1.2 の続きで更新・end-session・back-channel の結合確認を追加する。
