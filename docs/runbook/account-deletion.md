# 退会と復旧

A1.4 の本人用画面は `/settings`。新規退会は `FEATURE_ACCOUNT_LIFECYCLE=1` のときだけ使える。API と worker で同じ DB、`AUTH_SECRET`、`AUTH_BASE_URL`、ストレージ設定を使う。本番 compose と監視への接続は A1.6、サービスの DB アダプターは A2 / A3。

## 起動と停止

```sh
pnpm db:migrate
pnpm worker:accounts
```

worker は起動時と毎分に、期限切れの物理削除、画像削除、通知配送、完了記録の削除を順に実行する。1 回の選択は全体 200 人・サービス 200 行、画像削除と配送は各 20 件。未処理分は次回に回る。pg-boss のスキーマは既存のキャラクター worker と同じでもキュー名は `account-maintenance` で別。

停止時は最大 25 秒で worker を止めてから DB を閉じ、プロセス全体の猶予は 30 秒。無効時は新しい要求を受けず、ジョブを消費しない。既存の cron や送信待ちの行は保持する。復旧はフラグを無効にしても可能。

## 状態と画像

- 全体退会は全セッションと OAuth トークンを消す。プロフィールとキャラクターは 30 日未満の再ログインで同じ ID に復旧する。期限ちょうど以後は復旧を拒否し、worker が利用者と従属データを物理削除する。
- サービス退会はそのサービスのトークンだけを消す。Lumorphia とほかのサービスは残す。期限内のそのサービスへのログイン、または設定画面の復旧で戻る。全体復旧で以前のサービス退会を取り消さない。
- アップロード画像は直後に削除要求へ入れる。プロフィールと外部ログイン情報の画像 URL も消す。復旧で旧画像は戻らず、再アップロードは削除待ちのキーを避ける。保存中のアップロードと退会は利用者の行ロックで順序づける。
- 完了した配送・画像削除の記録は 30 日後に削除する。未完了の記録は利用者が物理削除されても保持する。

## 通知の登録と受信

OIDC クライアントの設定に `lifecycleUri` を指定する。省略時は redirect URI の origin の `/api/lumorphia/account-events`。登録時の metadata は `lumorphia_service` と `lifecycle_uri`。既存クライアントは名前、認可・トークンから利用先を拾い、既定の URI を使う。停止・廃止したクライアントにも投入済みの通知を送り続けるため、受信先を先に撤去しない。

POST は `application/x-www-form-urlencoded` の `event_token` 1 個。署名は EdDSA、`typ: lumorphia-account-event+jwt`、`iss` は `AUTH_BASE_URL`、`aud` は client ID。`sub` は Lumorphia ID、`jti` は送信待ちの ID。`iat` / `exp` は試行ごとに更新し、有効期間は 120 秒。JWKS は `/api/auth/jwks`。

`lifecycle` は `service`、正の整数 `revision`、`state` (`active` / `deleted` / `purged`)、`scope` (`account` / `service`)、ISO UTC の `occurredAt`、`deletedAt`、`recoverUntil`。`deleted` だけ退会日時とその 30 日後の期限を持ち、ほかは null。発生日時は再送しても変わらない。

受信側は `@lumorphia/auth-client` の `createAccountEventVerifier` と `createAccountEventHandler` を使い、`applyOnce` にサービス自身の DB 処理を実装する。2xx は適用または重複の受付後に返す。古い revision は再適用しない。状態・重複排除・セッション失効・画像削除の投入が失敗した場合は全体を rollback する。RP の role、ban、規約同意をイベントで書き換えない。

期限切れ後の再利用は通知の到着を待たず、サービス自身の期限を確認して旧データを削除してから新規利用を始める。OIDC のログイン時は ID トークンの署名に加え UserInfo で現在の active 状態を確認する。

## 配送と滞留

通信は HTTPS、redirect 不可、10 秒の timeout。2xx 以外は最初 1 分、指数的に最大 6 時間まで延ばして無期限に再試行する。同じ利用者と audience では前の revision を受け付けるまで後を送らない。画像削除も同じ再試行間隔。エラーは `http_N` / `delivery_failed` / `storage_failed` のコードだけで、トークンや外部のエラー本文を記録しない。

DB を変更せずに滞留を確認する例:

```sql
SELECT service, client_id, count(*) AS pending, min(created_at) AS oldest
FROM account_events WHERE delivered_at IS NULL GROUP BY service, client_id;
SELECT count(*) AS pending, min(created_at) AS oldest
FROM asset_deletions WHERE deleted_at IS NULL;
SELECT last_error, count(*) FROM account_events
WHERE delivered_at IS NULL GROUP BY last_error;
```

受信先の証明書・到達性、同じ issuer と audience、RP の DB アダプター、worker の起動とフラグを確認する。通知を手で配達済みにしたり、滞留行を消したりしない。再起動しても送信待ちの表が残るので、受付と復旧の順序を維持できる。
