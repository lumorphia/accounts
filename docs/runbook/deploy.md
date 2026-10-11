# 本番の起動と更新

同じ VPS 上の Prismtone と、DB・ボリューム・Compose project を分ける。公開の判断と記録は [release.md](release.md) (2026-10-11 に公開)。

## 1. 配置と秘密

VPS の置き場所 (例: `/srv/accounts`、2026-10 は `~/srv/accounts`) に main の `compose.prod.yaml` と `.env.*` を置く。復元試験の `compose.restore-test.yaml` ([backup.md](backup.md)) と、滞留の監視の `docker/monitor/` ([monitoring.md](monitoring.md)) も同じ sha のものを写す (git で取ってこなくてよい。doco-cd に登録したあとは doco-cd が取ってくる)。Node のホストインストールは不要。Docker Compose v2 と既存の Caddy・doco-cd を使う。

`.env.production.example` と `.env.backup.example` から、Git に入れない `.env.production` と `.env.backup` を作り、権限を600にする。`REPLACE_WITH` を全て置き換える。パスワードは URL の値としても安全なランダムな文字列を使い、`POSTGRES_PASSWORD` と `DATABASE_URL` を一致させる。AUTH_SECRET は32文字以上の本番専用値を生成し、復元時にも同じ値を使う。Prismtone の秘密を流用しない。

アバターとバックアップの R2 バケットを分け、それぞれのバケットだけにアクセスできる認証を作る。バックアップは非公開で、`pg/` を30日で削除する lifecycle rule を設定する。アバターは公開 URL を別ドメインに設定する。`DEV_TLS_*`、mock、dev host 設定を本番に持ち込まない。

固定プロバイダーは `https://accounts.lumorphia.com/api/auth/callback/discord`（Google は google、X は twitter）を登録する。各組の ID / secret を設定する。Misskey / Mastodon はホスト別の連携。Lodestone の User-Agent にサービス名・版・連絡先を設定する。

## 2. 共有する Caddy

80/443 を持つ Caddy は lumorphia/prismtone のもの 1 つだけで、accounts もそこで受ける (prismtone の docs/runbook/deploy.md「同じ VPS のほかのサービスを Caddy に載せる」)。

- 共有のネットワーク `lumorphia-edge` を `docker network create lumorphia-edge` で作る。accounts の web はそこに `accounts-web` として出る (`compose.prod.yaml`)
- prismtone の proxy は `lumorphia-edge` にもつながり、`CADDY_SITES_DIR` の `*.caddy` を読み込む。そこに `docker/Caddyfile.accounts` を `accounts.caddy` として置く
- 証明書は prismtone の Caddy にある Cloudflare Origin CA の 1 枚 (`lumorphia.com` と `*.lumorphia.com`) をそのまま使う。Cloudflare の IP 以外を拒む `cloudflare_only` も prismtone の Caddyfile のものを使う
- Cloudflare の DNS proxy と Full (strict) を確かめる。直通が拒否されるまでは `CLIENT_IP_HEADER=cf-connecting-ip` を使わない

Caddy の設定は `caddy validate` で確かめてから reload する。公開前は Cloudflare Access で運営者だけがアクセスできるようにしていた (Zero Trust の Self-hosted アプリケーションで、運営者のメールアドレスだけを Allow。2026-10-11 に外した)。障害で新規アクセスを止めるときも同じ方法を使える。accounts 側は 80/443 も 3100 も DB のポートもホストに公開しない。

## 3. リリースとイメージ

リリースは release-please で作る (ADR-0016)。main への push で release-please がリリース PR (`package.json` の version と `CHANGELOG.md`) を開き直す。運営者がそれをマージするとリリース (`vX.Y.Z` のタグと GitHub Release) ができ、CI の `publish` が app と backup のイメージを `sha-<コミット>` で上げ、両方できてから同じイメージに `vX.Y.Z` と `latest` を付ける。develop や main へのマージだけではイメージを作らない。PR の Docker job はビルドと本番 compose の構文を確かめるだけ。

本番の compose は `${ACCOUNTS_TAG:-latest}` を使う。`.env.production` に `ACCOUNTS_TAG` を書かなければ `latest` (リリース済みの最新) になる。本番の版はコンテナの `APP_VERSION` (`1.2.3+<sha の先頭 7 文字>`) で確かめる。

```sh
dc() { docker compose --env-file .env.production -f compose.prod.yaml "$@"; }
dc config --quiet
docker exec accounts-web-1 printenv APP_VERSION
```

migration は起動ごとに適用済みの履歴を確認する。postgres が healthy になってから migration、完了後に web・2 worker を開始する。worker は web の healthy を待たない。35秒の停止猶予に対してアプリの停止期限は30秒。

`FEATURE_ACCOUNT_LIFECYCLE` と `FEATURE_LODESTONE` は本番では両方1。止めるときは0にして `dc up -d --force-recreate web accounts characters` で読み直す (止めている間の滞留は [monitoring.md](monitoring.md))。

## 4. doco-cd (自動デプロイ)

accounts 専用の doco-cd が main を5分ごとに見て、`.doco-cd.yml` に従って `compose.prod.yaml` を `docker compose up` する。`force_image_pull` で、Git に変更が無くても `latest` の digest が変われば入れ替える。リリース PR をマージしてから、イメージができて入れ替わるまで15分ほど。Prismtone の doco-cd とはコンテナを分ける (compose の変数を混ぜない)。外から入る口 (Webhook / REST API) は開けない。

登録の手順 (初回だけ):

1. 最初のリリース (1.0.0) が出て、GHCR に `latest` があることを確かめる。無いうちに登録すると pull に失敗する。`docker --config` には `config.json` の入ったディレクトリを渡す (認証のファイルが `docker-config.json` という名前なら、一時ディレクトリに `config.json` として結ぶ。認証なしだと、イメージがあっても `unauthorized` になる)

   ```sh
   d=$(mktemp -d) && ln -s /srv/doco-cd/docker-config.json "$d/config.json" \
     && docker --config "$d" manifest inspect ghcr.io/lumorphia/accounts-app:latest >/dev/null && echo ok
   rm -rf "$d"
   ```

2. `.env.production` から `ACCOUNTS_TAG` の行を消す (残すとその版に固定される)
3. `docker/doco-cd/compose.yaml` を VPS の `/srv/doco-cd-accounts/compose.yaml` に写し、「ホスト」と書いたパスを実際の場所に書き換える。GHCR の認証は Prismtone の doco-cd の `docker-config.json` を使う
4. doco-cd が読む秘密のファイルを、グループを root にして `640` にする。doco-cd のコンテナは root で動くが `cap_drop: ALL` で特権を落としているので、持ち主が自分で `600` のファイルは `permission denied` で読めない (`failed to load compose project: open .../.env.backup: permission denied`)。グループを root にすれば、コンテナの root はグループの権限で読め、持ち主は `sudo` なしで編集できる。`.env.monitor` は cron が読むだけなので `600` のまま

   ```sh
   sudo chgrp root /srv/accounts/.env.production /srv/accounts/.env.backup
   chmod 640 /srv/accounts/.env.production /srv/accounts/.env.backup
   ```

5. `docker compose -f /srv/doco-cd-accounts/compose.yaml up -d` で起動し、`docker logs -f doco-cd-accounts` で `job completed successfully` を待つ。最初の1回は compose の設定の出どころが変わるので、web と worker が作り直されることがある
6. `docker exec accounts-web-1 printenv APP_VERSION` がリリースの版になっていること、`/api/health` が200で両 worker が ok なことを確かめる

doco-cd を止めているときや、使えないときは、置き場所で `dc pull && dc up -d` を手で打つ。置き場所の `compose.prod.yaml` は main と同じものにしておく。

## 5. 更新と戻し方

更新はリリース PR のマージで行う。DB の変更を含むリリースの前には `dc run --rm backup once` を成功させ、時刻と版を運用記録に残す。入れ替わったら、外部から health、discovery、ログイン、表示、画像と worker を確認する。

DB の変更は自動で down migration しない。互換性があると確認できた前の版だけに戻す。戻すときは `.env.production` に `ACCOUNTS_TAG=vX.Y.Z` を書いて `docker restart doco-cd-accounts` (doco-cd は起動時の値を使う)。直したリリースが出たら、`ACCOUNTS_TAG` の行を消して、もう一度 doco-cd を再起動する。破壊的な変更・DB 障害は新規アクセスを制限し、[復元](backup.md)を行う。`down -v` は使わない。Prismtone の project やボリュームは操作しない。
