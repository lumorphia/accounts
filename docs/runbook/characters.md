# キャラクターの worker

A1.3b の登録・本人確認・主キャラクター変更・削除・再同期は core のドメインにある。画面と HTTP API の接続は A1.3c。

## 手元で起動する

PostgreSQL の起動と `pnpm db:migrate` を済ませ、`.env` の `FEATURE_LODESTONE=1` を設定してから:

```sh
pnpm worker:characters
```

既定は `FEATURE_LODESTONE=0`。その場合、キューの準備だけをして待ち、確認・同期・週次の worker を登録しない。既存の要求はキューに残る。値を変えたら worker を再起動する。

本番では `NODE_ENV=production` を設定し、`LODESTONE_USER_AGENT` にサービス名・版・連絡先を含める。`LODESTONE_BASE_URL` の既定は `https://jp.finalfantasyxiv.com`。本番は公式の HTTPS origin だけを受ける。開発と E2E の差し替えは開発環境だけで使う。

worker 内は 1 つの HTTP クライアントを共有し、同時 1 件・開始間隔 1 秒以上で読む。A1.3c で API とつなぐときは、別プロセスの取得も含めて経路をまとめる。それまではこのコマンドで本番の取得を始めない。

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

Lodestone は FakeLodestoneSource と fixture を使い、実サイトにはアクセスしない。worker の結合テストは新しいテスト用キュースキーマを使う。
