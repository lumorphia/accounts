# ADR-0016: リリースは release-please で作り、本番は latest を doco-cd で入れ替える

| 項目     | 内容                                                                    |
| -------- | ----------------------------------------------------------------------- |
| Status   | Accepted                                                                |
| Date     | 2026-10-11                                                              |
| Deciders | t1nyb0x                                                                 |
| 置き換え | [ADR-0010](0010-production-and-legal-consent.md) のイメージの公開の一文 |

## Context

ADR-0010 では、公開判断の前に本番のイメージができないよう、GHCR への公開を main に対する手動の workflow (`publish-images.yml`) にし、`sha-<コミット>` のタグだけを付けた。本番は VPS の `ACCOUNTS_TAG` にその sha を書き、手で `docker compose up` していた。

2026-10-11 に公開の判断が済み、Cloudflare Access を外した ([release.md](../runbook/release.md))。手動の公開を続ける理由は無くなった。今の形のままだと、リリースのたびに workflow を動かし、VPS の秘密のファイルの `ACCOUNTS_TAG` を書き換え、doco-cd を再起動することになる。

同じ VPS の lumorphia/prismtone は、release-please のリリース PR をマージしたときだけイメージを作って `vX.Y.Z` と `latest` を付け、doco-cd が `latest` の digest の変化を見て入れ替えている (prismtone ADR-0031、#257)。

## Decision

- release-please でリリースを作る。main への push で release-please がリリース PR (`package.json` の version と `CHANGELOG.md`) を開き直し、運営者がそれをマージするとリリース (`vX.Y.Z` のタグと GitHub Release) ができる。版はリポジトリで 1 つ (サービスのパッケージを公開しないので、パッケージごとに分けない)。最初のリリースは 1.0.0
- イメージはリリースができたときだけ CI で作る。app と backup を `sha-<コミット>` で上げ、両方できてから同じイメージに `vX.Y.Z` と `latest` を付ける。develop や main へのマージだけでは作らない。`publish-images.yml` は消す
- 本番の compose は `${ACCOUNTS_TAG:-latest}` を使う。普段は `ACCOUNTS_TAG` を書かず、doco-cd (`force_image_pull`) が `latest` の digest の変化を見つけて入れ替える。前の版に戻すときだけ `ACCOUNTS_TAG=vX.Y.Z` を書く
- 検査 (check・e2e・security・docker のビルド確認) は今までどおり PR でだけ回す。main への push で回すのは release とイメージの公開だけ
- doco-cd は accounts 専用のコンテナを立てる。compose の変数 (`POSTGRES_PASSWORD` など) を Prismtone と混ぜないため

## Consequences

リリースの操作は「リリース PR をマージする」だけになり、VPS の秘密のファイルを書き換えなくてよい。人が明示的にリリースする歯止めは、リリース PR のマージで残る。

`latest` を pull するので、タグからは本番の版が分からない。コンテナの `APP_VERSION` (`1.2.3+<sha の先頭 7 文字>`) で確かめる。戻すときの手順は [deploy.md](../runbook/deploy.md) に書く。

develop の `package.json` の version は 0.0.0 のまま進む (release-please は main だけで版を上げる)。develop → main のマージで version の行はぶつからない。

## References

- [ADR-0010](0010-production-and-legal-consent.md)
- prismtone ADR-0031 (doco-cd)、lumorphia/prismtone#257 (latest をリリースのときだけ付け替える)
