# lumorphia/accounts

Lumorphia アカウント。Lumorphia のサービス (Prismtone、Scenote) のログイン、handle、キャラクター (Lodestone の確認) を受け持ち、各サービスには OIDC で「Lumorphia でログイン」を提供する。

計画は [docs/plan.md](docs/plan.md)、判断は [docs/adr/](docs/adr/)、弱点の知らせ方は [SECURITY.md](SECURITY.md)。A1.6 の公開準備まで実装済み。本番公開はまだ行っていない。続きは [引き継ぎ](docs/handoff-a1-6.md)。本番の手順は [起動と更新](docs/runbook/deploy.md)、[監視](docs/runbook/monitoring.md)、[バックアップ](docs/runbook/backup.md)、[公開判断](docs/runbook/release.md)。

## 手元で動かす

Node 24.21 以上、pnpm 12.8.1 以上、Docker、openssl が要る。

```sh
pnpm install                # @lumorphia/* は GitHub Packages。下の「パッケージのトークン」
cp .env.example .env
pnpm dev:certs              # 開発と E2E の TLS (.data/tls/ に手元専用の CA と *.lumorphia.test の証明書)
docker compose up -d        # PostgreSQL (5434) と Caddy (https を 8443 で受ける)
pnpm db:migrate
pnpm --filter @lumorphia-accounts/app dev   # http://127.0.0.1:3100 (Caddy の後ろ)
```

ブラウザでは `https://accounts.lumorphia.test:8443/` を開く。初回だけ、使う OS で次の 2 つをする。

- **名前**: hosts に `127.0.0.1 accounts.lumorphia.test` を足す (Windows は `C:\Windows\System32\drivers\etc\hosts`)
- **証明書**: `.data/tls/ca.pem` を「信頼されたルート証明機関」に入れる。手元専用の CA で、`.data/tls/ca-key.pem` は外に出さない。要らなくなったら外す

E2E はこの 2 つが無くても動く (Chromium に名前の向け先を渡し、証明書の検証を飛ばす。`playwright.config.ts`)。

`AUTH_SECRET` はセッションとOIDC署名鍵の暗号化に使うため、DBを作った後は同じ値を使い続ける。Discord・Googleなどの `AUTH_*_ID` / `AUTH_*_SECRET` を設定するときも、`AUTH_SECRET` は変更しない。変更後に「Failed to decrypt private key」が出る場合は、以前の値に戻して開発サーバーを再起動する。

### パッケージのトークン

`@lumorphia/*` (lumorphia/platform) は GitHub Packages にあり、読むには `read:packages` のトークンが要る。リポジトリの `.npmrc` には向き先だけを書いてある。手元では一度だけ:

```sh
pnpm config set //npm.pkg.github.com/:_authToken "$(gh auth token)"
```

## ブランド画面とトップ

トップは隣の `website/` が配信し、このアプリはログイン・初回登録・アカウント管理を提供する。通常ログイン後は `WEBSITE_ORIGIN` のトップへ戻る。署名付きOIDCの認可と退会復旧は既存の導線を維持する。

トップからの表示用セッション取得だけを `WEBSITE_ORIGIN` に許可する。手元のトップへ戻す場合は、HTTPSかつAccountsと同じサイトのオリジンを設定する。[websiteの設定](../website/README.md)と[設計判断](docs/adr/0014-brand-and-website-navigation.md)を参照。

[実画面の確認画像](docs/design/implemented/README.md)と[採用案](docs/design/previews/lumorphia-brand/README.md)の説明を置いている。画像そのものは git に入れず手元にだけ置く (`pnpm e2e e2e/brand.spec.ts` で撮り直す)。

## ライセンス

[AGPL-3.0-only](LICENSE)
