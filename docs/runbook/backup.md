# バックアップと復元

accounts 専用の非公開 R2 バケットと専用の認証を使い、1日ごとに PostgreSQL 18 の `pg_dump -Fc` を保存する。画像は復元しない。バケットの `pg/` に30日で期限切れとなる削除 rule を設定する。[R2 の lifecycle](https://developers.cloudflare.com/r2/buckets/object-lifecycles/) は通常、期限から24時間以内に削除するが遅れる場合もあるため、残存オブジェクトも確認する。アバターと backup の認証・バケットを混ぜない。

## バックアップ

`.env.backup.example` から `.env.backup` を作る。compose の backup は同じ DB へ接続し、開始時と24時間ごとに一度取得する。完成した dump だけを転送し、終了後は一時ファイルを消す。失敗の生の DB エラーや認証をログに出さない。

```sh
dc run --rm backup once
dc run --rm backup list
```

完了ログだけでは監視を済ませず、リモートの新しいオブジェクトを確認する。秘密のバックアップファイルや内容を GitHub・PR・テストログに貼らない。AUTH_SECRET と外部認証の設定は別の安全な場所で保管する。dump は JWKS の署名鍵と OAuth client secret を含むため、利用者データと同じく機密扱いにする。

## 隔離した復元試験

公開前と、その後の定期試験で行う。main の承認 sha、dump の時刻、件数だけを非公開の運用記録に残す。本番の DB や Prismtone の DB を復元先に使わない。

1. バックアップ専用の認証で dump を取り出し、権限600で保管する。
2. 新しい隔離した Compose project の PostgreSQL 18 に空の DB を作る。公開 Caddy・本番 R2・本番の受信先・本番の外部ログインに接続しない。
3. `pg_restore --no-owner --no-acl --exit-on-error --dbname=<隔離DB> <dump>`。復元先の URL や秘密をログに書かない。失敗した復元先は試験用に限って作り直す。
4. 承認 sha の migration を適用する。利用者・連携・キャラクター・旧台帳・outbox・画像削除要求・JWKS の件数を確認する。`worker_heartbeats` は空にして、試験の worker に書かせる。
5. mock のみを使って OIDC の発行・検証と失効、30日の境界、削除・通知の再送を試す。本番の outbox を本番サービスへ送らない。本番の画像ストレージへ削除を送らない。
6. dump を削除し、隔離 project の試験用データだけを片付ける。

## 本当の障害からの復元

公開アクセスを制限し、worker を停止する。復元前に残存 DB と、バックアップ取得後の退会・削除・通知の記録を可能な範囲で退避する。復元先を確認してから、承認した dump と同じ AUTH_SECRET で復元する。migration 適用後、全セッション・OAuth の有効トークンを失効させ、過去のセッションを復活させない。client 登録と鍵の継続性を確認する。

バックアップ後の退会・利用制限・画像削除と、各サービスが既に受け取った revision を照合する。再送する revision を巻き戻して古い状態を適用させない。退会済み画像のキーをプロフィールへ戻さず、削除要求を再投入する。30日の期限切れを先に処理する。照合できない場合は公開制限を維持し、運営者が扱いを決めてから再開する。

試験した旧 sha へ戻せるか、discovery / JWKS と両 worker が healthy か、未配送の通知と削除が進むかを確認してから公開を再開する。バックアップの存在だけで公開条件を満たしたことにしない。
