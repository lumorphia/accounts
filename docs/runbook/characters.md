# キャラクターの設定と worker

`/settings` から登録・本人確認・トークン再発行・主キャラクター変更・登録解除・再同期を行う。URL / ID または名前とワールドで登録する。自己紹介に発行したトークンを貼り付け、24 時間以内に確認する。再同期の受付は処理完了ではなく、キューへの投入を表す。

## 手元で起動する

PostgreSQL の起動と `pnpm db:migrate` を済ませ、`.env` の `FEATURE_LODESTONE=1` を設定してから:

```sh
pnpm worker:characters
```

既定は `FEATURE_LODESTONE=0`。その場合、キューの準備だけをして待ち、確認・同期・週次の worker を登録しない。既存の要求はキューに残る。API も登録・確認・同期要求を停止する。一覧・主キャラ変更・登録解除は続けられる。値を変えたら API と worker の両方を再起動する。

本番では `NODE_ENV=production` を設定し、`LODESTONE_USER_AGENT` にサービス名・版・連絡先を含める。`LODESTONE_BASE_URL` の既定は `https://jp.finalfantasyxiv.com`。本番は公式の HTTPS origin だけを受ける。開発と E2E の差し替えは開発環境だけで使う。

API と worker の HTTP 試行は `public.lodestone_pacing` の 1 行を共有する。同時 1 件で、本文の受信完了から次の取得まで最低 1 秒空ける。失敗・再試行も同じ制御を通る。専用の DB 接続は各プロセス最大 1 本。起動前に新しいマイグレーションを適用し、API と worker に同じ accounts の DB を設定する。DB が使えない場合は取得へ進まない。判断は [ADR-0007](../adr/0007-character-api-and-shared-pacing.md)。

## HTTP API

本人用は active セッションと、変更系では同一 Origin が必要。応答はキャッシュしない。

| 入口                                 | 処理                                                  |
| ------------------------------------ | ----------------------------------------------------- |
| `GET /api/me/characters`             | 一覧と取得の有効状態                                  |
| `POST /api/me/characters`            | `{ lodestone }` または `{ name, world }` で登録 (201) |
| `POST /api/me/characters/:id/token`  | トークン再発行                                        |
| `POST /api/me/characters/:id/verify` | 所有確認。`result` と最新のキャラクター               |
| `POST /api/me/characters/:id/sync`   | 再同期要求 (202)。24 時間に 1 回                      |
| `PUT /api/me/characters/:id/primary` | 主キャラクターを変更                                  |
| `DELETE /api/me/characters/:id`      | 登録を解除                                            |

サービスは認可時に `lumorphia:characters` を要求し、本人の access token を `Authorization: Bearer ...` で `GET /api/characters` に渡す。クエリで利用者 ID を指定する入口はない。確認済みの一覧だけを返し、トークン・自己紹介・内部エラーは返さない。一覧の取得は Lodestone へ接続しない。Cookie や ID トークンでは読み取れない。

登録済みサービスでも scope が無ければ 403。無効・失効済みの access token は 401、現在の利用者が active でなければ 403。`Cache-Control: no-store` を返す。既存クライアントに権限を自動追加しないので、運営者が必要なクライアントだけに scope を追加するか、登録スクリプトで新しく登録して利用側を切り替える。

## ジョブ

| 名前                 | 処理                                                                                   |
| -------------------- | -------------------------------------------------------------------------------------- |
| `character-verify`   | 自己紹介のトークンを確認し、結果を characters に書く                                   |
| `character-sync`     | 確認済みのプロフィールを更新する                                                       |
| `character-sync-all` | 毎週月曜 04:00 (Asia/Tokyo)、1 週間以上取り直していないキャラクターを 1 件ずつ投入する |

手動同期は `requestSync` を通す。最後の同期と要求から 24 時間空け、要求時刻とジョブは一緒に確定する。直接 pg-boss に投入するとこの制限を通らない。

利用者が有効でなければ背景ジョブは skip。キャラクターを削除した後のジョブも skip。Lodestone の取得エラーはキャラクターの状態に書き、確認済みは取り消さない。同期が 3 回続けて失敗すると `sync_error` が出る。

ログにはジョブ ID・種類・結果を出す。確認トークンと自己紹介は出さない。SIGTERM / SIGINT では処理中のジョブを待ってから DB を閉じる。Docker と監視への本番接続は A1.6。

## 検証

`pnpm test` は `.env` を自動では読まないので、手元では次を使う (専用 DB をファイルごとに作る):

```sh
node --env-file-if-exists=.env node_modules/vitest/vitest.mjs run --coverage
```

Lodestone は FakeLodestoneSource と fixture を使い、実サイトにはアクセスしない。worker の結合テストは新しいテスト用キュースキーマを使う。取得間隔は独立した DB 接続を使って確認する。`pnpm e2e` は HTTPS のアプリから登録・確認・再同期のキュー投入・削除と、サービス用の読み取りを確認する。ローカル Lodestone モックは運営者の fixture を返し、実サイトへ接続しない。
