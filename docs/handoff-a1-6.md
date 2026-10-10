# A1.6 の引き継ぎ

A1.6 のリポジトリ側の公開準備を実装した。本番はまだ公開していない。main の昇格、GHCR のイメージ公開、Caddy / doco-cd の登録、本番 DB や実データの操作も未実施。

## できたもの

- `/terms` と `/privacy`、共通フッター。本文は `docs/legal/`。共通アカウントの規約と各サービスの規約を分け、収集・提供・外部処理・削除の説明を実装に合わせた。
- 初回設定で2文書の版と15歳以上の確認を必須にした。current 以外や確認の無い登録は active にせず、版とサーバーの同意日時を同じ transaction で保存する。生年月日は収集しない。開発専用の自動設定だけはテスト用の同意を与える。
- worker の30秒の心拍。2分以上の停止、無効・未登録・未来の心拍を、有効な機能の `/api/health` で503として検知する。健康な心拍と処理の成功は分け、配送・画像・purge・キャラクターの滞留は `docker/monitor/backlog.sh` で件数だけを出す。退会した利用者のキャラクターは滞留通知から除く。
- 専用 PostgreSQL とバックエンド、web だけの `lumorphia-edge` 接続を持つ `compose.prod.yaml`。80/443 の Caddy は既存のものを使う。worker は web の healthy を待たず migration の完了から起動する。
- 非 root の app image と backup image、BuildKit の npm secret、固定 sha のタグ。PR の Docker CI は build のみ、公開 workflow は main の手動実行だけ。本番の HTTP アクセスログは収集しない。
- 日次 pg_dump の完成後の転送と失敗判定。backup の認証はアバターと分離。R2 の lifecycle は30日で期限切れとし、反映の遅れも文書に書いた。
- 本番起動・監視・バックアップ / 隔離復元・公開判断の runbook と ADR-0010。

## 確認したもの

単体・PostgreSQL 全体404件（新規15件）、HTTPS E2E 全体31件（新規2件）。lint・format:check・typecheck 成功。行90.36%、branch81.15%。既存の取得間隔のテストは、commit 後の時刻から測る不安定な方法を、取得の失敗から次の取得開始までの測定へ直した。

app / backup の Docker image をローカルでビルドし、隔離した PostgreSQL に migration を適用して、非 root の本番 app と2 worker を起動した。規約の SSR と discovery、退会 worker の停止時の503 / 再開後の200を確認した。テスト用 DB の dump を backup image の PostgreSQL 18 ツールで別 DB に復元し、22の公開スキーマの表と滞留 SQL を確認した。一時コンテナと dump は片付けた。R2 への実転送や本番の通知は、このローカル確認に含まない。

## 次に行うこと

[公開判断](runbook/release.md) に従い、本番専用の設定・5種類の実ログイン・共有 Caddy・R2・Lodestone・外部監視・通知・バックアップと復元を確認する。両機能フラグは初期値0で、公開時は1にする。公開可否は運営者が対象 SHA と確認結果を見て決める。文書の重要な改定前には既存利用者の再同意と認可制御を実装する。

A2 は Prismtone の旧新規登録停止・台帳・確認画面・データの引き継ぎ・完了通知の再送・文書改定・利用者への案内。本番公開の確認と並行してコードの準備はできるが、A2 の切り替えは別に判断する。移行期限を設けない。

開始時からある未追跡の `docs/handoff-a1-1.md` は変更にもコミットにも含めていない。
