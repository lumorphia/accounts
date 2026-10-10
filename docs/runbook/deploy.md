# 本番の起動と更新

同じ VPS 上の Prismtone と、DB・ボリューム・Compose project を分ける。公開するかは [release.md](release.md)。この手順を用意したことは本番公開を意味しない。

## 1. 配置と秘密

VPS の置き場所 (例: `/srv/accounts`、2026-10 は `~/srv/accounts`) に公開判断を終えた main の `compose.prod.yaml` と `.env.*` を置く (git で取ってこなくてよい。doco-cd に登録したあとは doco-cd が取ってくる)。Node のホストインストールは不要。Docker Compose v2 と既存の Caddy・doco-cd を使う。

`.env.production.example` と `.env.backup.example` から、Git に入れない `.env.production` と `.env.backup` を作り、権限を600にする。`REPLACE_WITH` を全て置き換える。パスワードは URL の値としても安全なランダムな文字列を使い、`POSTGRES_PASSWORD` と `DATABASE_URL` を一致させる。AUTH_SECRET は32文字以上の本番専用値を生成し、復元時にも同じ値を使う。Prismtone の秘密を流用しない。

アバターとバックアップの R2 バケットを分け、それぞれのバケットだけにアクセスできる認証を作る。バックアップは非公開で、`pg/` を30日で削除する lifecycle rule を設定する。アバターは公開 URL を別ドメインに設定する。`DEV_TLS_*`、mock、dev host 設定を本番に持ち込まない。

固定プロバイダーは `https://accounts.lumorphia.com/api/auth/callback/discord`（Google は google、X は twitter）を登録する。各組の ID / secret を設定する。Misskey / Mastodon はホスト別の連携。Lodestone の User-Agent にサービス名・版・連絡先を設定する。

## 2. 共有する Caddy

80/443 を持つ Caddy は lumorphia/prismtone のもの 1 つだけで、accounts もそこで受ける (prismtone の docs/runbook/deploy.md「同じ VPS のほかのサービスを Caddy に載せる」)。

- 共有のネットワーク `lumorphia-edge` を `docker network create lumorphia-edge` で作る。accounts の web はそこに `accounts-web` として出る (`compose.prod.yaml`)
- prismtone の proxy は `lumorphia-edge` にもつながり、`CADDY_SITES_DIR` の `*.caddy` を読み込む。そこに `docker/Caddyfile.accounts` を `accounts.caddy` として置く
- 証明書は prismtone の Caddy にある Cloudflare Origin CA の 1 枚 (`lumorphia.com` と `*.lumorphia.com`) をそのまま使う。Cloudflare の IP 以外を拒む `cloudflare_only` も prismtone の Caddyfile のものを使う
- Cloudflare の DNS proxy と Full (strict) を確かめる。直通が拒否されるまでは `CLIENT_IP_HEADER=cf-connecting-ip` を使わない

Caddy の設定は `caddy validate` で確かめてから reload する。公開判断前は Cloudflare Access で運営者だけがアクセスできる状態を保つ (2026-10 は Zero Trust の Self-hosted アプリケーションで、運営者のメールアドレスだけを Allow)。accounts 側は 80/443 も 3100 も DB のポートもホストに公開しない。

## 3. ビルドと起動

PR の Docker job は app と backup の build を確認するだけ。公開承認後、main の CI が通ったコミットに `publish-images` workflow を手動実行する。`ACCOUNTS_TAG=sha-<40桁のコミット>` を設定する。app と backup が両方存在することを確認する。latest は使わない。

```sh
dc() { docker compose --env-file .env.production -f compose.prod.yaml "$@"; }
dc config --quiet
dc pull
dc up -d
```

migration は起動ごとに適用済みの履歴を確認する。postgres が healthy になってから migration、完了後に web・2 worker を開始する。worker は web の healthy を待たない。35秒の停止猶予に対してアプリの停止期限は30秒。

`FEATURE_ACCOUNT_LIFECYCLE` と `FEATURE_LODESTONE` の0は初期確認用。公開時は両方1にし、`dc up -d --force-recreate web accounts characters` で同じ設定を読み直す。心拍が新しくなったこと、[監視](monitoring.md)と[復元試験](backup.md)を確認してから公開制限を外す。

## 4. 更新と戻し方

更新前に `dc run --rm backup once` を成功させ、時刻と固定 sha を運用記録に残す。新しいタグに変え、`dc pull && dc up -d`。外部から health、discovery、ログイン、表示、画像と worker を確認する。

DB の変更は自動で down migration しない。互換性があると確認できた旧 app sha のみ戻す。破壊的な変更・DB 障害は公開制限を戻し、[復元](backup.md)を行う。`down -v` は使わない。Prismtone の project やボリュームは操作しない。

doco-cd は公開判断後に `.doco-cd.yml` を登録し、`ACCOUNTS_ENV_FILE` に秘密のファイルの絶対パスを渡す。Compose の展開に必要な `ACCOUNTS_TAG` と `POSTGRES_PASSWORD`、backup の env file の絶対パスも、その管理する環境ファイルから渡す。固定 sha の変更は明示的なリリース操作として記録する。
