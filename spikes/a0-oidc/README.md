# A0 spike: Lumorphia アカウントを OIDC の発行元にする

2026-10-06。`node spike.mjs` で 21/21 が通る (要るもの: `certs/` の自己署名証明書。作り方は下)。

## 結論

**Better Auth 1.7.7 + `@better-auth/oauth-provider` 1.7.7 を発行元に採用する。** サービス側は Prismtone がすでに使っている Better Auth の `generic-oauth` で受けられる。

## 何を確かめたか

| 構成            | 中身                                                                                                                 |
| --------------- | -------------------------------------------------------------------------------------------------------------------- |
| サービス (RP)   | `https://scenote.lumorphia.test:4101`。Better Auth + `generic-oauth` (discovery、PKCE)                               |
| Lumorphia (IdP) | `https://accounts.lumorphia.test:4100`。Better Auth + `jwt` + `oauth-provider`。ログインは `socialProviders.discord` |
| Discord         | 偽物 (token と users/@me)。Prismtone の E2E と同じく fetch の向き先を差し替える                                      |

| 確かめたこと                                                                                                     | 結果                                                               |
| ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| discovery (`/api/auth/.well-known/openid-configuration`、root にも出せる)、PKCE S256、back-channel logout の広告 | 通る                                                               |
| 運営者のセッションでクライアントを登録 (`adminCreateOAuthClient`、`skip_consent`、`enable_end_session`)          | 通る                                                               |
| サービス → Lumorphia のログイン画面 → Discord → Lumorphia → 認可の続き → サービス                                | 通る。同意画面は出ない                                             |
| ID トークンの検証 (EdDSA、JWKS、issuer、audience)                                                                | 通る                                                               |
| カスタム claim (`handle`、`legacy_pending`、`identities`) が ID トークンと userinfo に載る                       | 通る。旧 Prismtone の台帳で `legacy_pending: ["prismtone"]` が出る |
| Lumorphia にログイン済みなら画面なしで戻る (SSO)                                                                 | 通る                                                               |
| 自前のログイン (MiAuth の代わり) のあと、署名付きの query で authorize に戻ると続きになる                        | 通る                                                               |
| end-session のあと、Lumorphia のログインが要る                                                                   | 通る                                                               |

## 分かったこと (本設計に効くもの)

1. **web クライアントの redirect URI は https、しかもループバック以外のホスト名に限られる** (`localhost` も `127.0.0.1` も不可)。開発と E2E は `*.lumorphia.test` などの名前と TLS が要る。Prismtone の E2E の `http://localhost` の作りはそのままでは使えない。Caddy の内部 CA か mkcert で組む
2. **back-channel logout は 1 回しか送らない** (仕様 §2.5 のとおり)。ログアウトの知らせには使えるが、退会の知らせには使えない。退会は計画 3 章のとおり、送り直しのある自前の webhook にする
3. **クライアントの登録 (`adminCreateOAuthClient`) にも運営者のセッションが要る** (`SERVER_ONLY` だが session を見る)。本番はクライアントを登録するスクリプトを、運営者のアカウントで動かす
4. **`generic-oauth` (1.7) は専用の入口を持たない**。サービスは `/sign-in/social` に `provider: "lumorphia"` を渡し、callback は `/api/auth/callback/lumorphia`
5. **カスタム claim は ID トークン用 (`customIdTokenClaims`) と userinfo 用 (`customUserInfoClaims`) の両方に載せる**。`generic-oauth` の `mapProfileToUser` は userinfo から作られる
6. **MiAuth と Mastodon (自前のログイン) は、ログインの前に署名付きの query を持っておき、ログインのあと `/api/auth/oauth2/authorize?<query>` に戻せば続きになる**。Better Auth の外で作ったセッションでも同じ
7. `identities` は Prismtone のクライアントにだけ渡す。クライアントごとに登録した `scope` から外れたものは要求できないので、Scenote のクライアントには `lumorphia:identities` を登録しない
8. ID トークンの署名は EdDSA (Ed25519)。`jose` で検証できる

## 確かめていないこと

- back-channel logout が実際に届くか (配送時に公開アドレスかを見るため、spike の構成では送れない)。A1 の E2E で、公開アドレスを装う方法を決めてから
- 署名鍵の更新 (`jwt` プラグインの鍵の追加と古い鍵の保持)
- refresh token。サービスはログインのときにしか Lumorphia を使わないので、要らない見込み
- PostgreSQL と Drizzle で動かすこと (spike はメモリの DB)
- 本物のブラウザ。spike のブラウザ役は `node:https` で、画面遷移のヘッダー (`sec-fetch-mode: navigate`) を付けている。Node の `fetch` (undici) は `sec-fetch-mode: cors` を必ず付けるので、Better Auth が 302 の代わりに JSON を返し、画面遷移を再現できない

## 動かし方

```sh
pnpm install
mkdir -p certs && openssl req -x509 -newkey rsa:2048 -nodes -keyout certs/key.pem -out certs/cert.pem -days 7 \
  -subj "/CN=lumorphia.test" -addext "subjectAltName=DNS:accounts.lumorphia.test,DNS:scenote.lumorphia.test"
node spike.mjs
```

`*.lumorphia.test` は spike の中で 127.0.0.1 に向けている (`/etc/hosts` は触らない)。
