# lumorphia/accounts

Lumorphia アカウント。Lumorphia のサービス (Prismtone、Scenote) のログイン、handle、キャラクター (Lodestone の確認) を受け持ち、各サービスには OIDC で「Lumorphia でログイン」を提供する。

計画は [docs/plan.md](docs/plan.md)、判断は [docs/adr/](docs/adr/)、弱点の知らせ方は [SECURITY.md](SECURITY.md)。今は A1.0 (骨組み) の段階。

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

### パッケージのトークン

`@lumorphia/*` (lumorphia/platform) は GitHub Packages にあり、読むには `read:packages` のトークンが要る。リポジトリの `.npmrc` には向き先だけを書いてある。手元では一度だけ:

```sh
pnpm config set //npm.pkg.github.com/:_authToken "$(gh auth token)"
```

## ライセンス

[AGPL-3.0-only](LICENSE)
