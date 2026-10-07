# ADR-0007: キャラクター API の権限と Lodestone の取得順を共有する

| 項目     | 内容       |
| -------- | ---------- |
| Status   | Accepted   |
| Date     | 2026-10-07 |
| Deciders | t1nyb0x    |

## Context

A1.3c で本人の設定画面と API、サービス向けの読み取りをつなぐ。API と worker は別プロセスなので、アダプター内の順番待ちだけでは同時取得と間隔を保てない。サービスに確認トークンを渡さず、認可された本人の確認済みキャラクターだけを返す必要がある。

## Decision

- 本人用は `/api/me/characters` とその配下。active セッションを必須にし、変更系には既存の同一 Origin 確認を適用する。登録・再発行・確認・同期要求は IP ごと・各入口ごとに 1 分 10 回まで。主キャラと登録解除は取得を停止していても使える。
- サービス用は `GET /api/characters`。登録した自社クライアントに `lumorphia:characters` scope を付ける。サービスは認可要求にもこの scope を指定する。既存クライアントには自動で権限を足さず、必要なら運営者が設定し直す。
- Better Auth oauth-provider の `getOAuthProviderApi(...).requireActiveAccessToken` をパスのないサーバー内専用 endpoint で使う。独自の署名検証やトークンのハッシュ処理を複製しない。Bearer の access token、登録先と scope、最新の active 状態を確かめる。Cookie や ID トークンによるサービス用読み取りは受け付けない。
- 対象は access token の `sub` から決める。利用者 ID をクエリで受けず、確認済みだけを返す。返す項目を Zod スキーマで明示し、確認トークン、自己紹介、利用者 ID、内部の同期失敗回数とエラーを渡さない。本人用とサービス用の応答は `Cache-Control: no-store`。
- `lodestone_pacing` の 1 行を各 HTTP 試行で `FOR UPDATE` し、本文を読み終えるまで保持する。前回の本文受信完了から最低 1 秒待って次を始める。検索、登録、確認、背景同期、HTTP の再試行が同じ制御を使う。時刻と待機には PostgreSQL の `clock_timestamp()` / `pg_sleep()` を使う。
- ネットワークや本文受信の失敗も完了時刻を commit してから伝える。取得制御の DB が使えなければ外部取得へ進まない。API と worker は専用の最大 1 接続の pool を持ち、同期が利用者のトランザクションを保持していても制御用の接続を確保する。
- pg-boss の `pgboss` スキーマはライブラリ自身が管理し、Drizzle は `public` のみを生成対象にする。API はキューの準備と投入だけを行い、消費と週次 cron は独立した worker が持つ。
- E2E は HTTPS のアプリと運営者の HTML fixture を返すローカルの Lodestone モックを使う。OAuth モックがプロバイダーごとに 1 人の情報を共有するため、ファイル間も順に実行する。

## Consequences

プロセスを増やしても accounts 全体の同時取得は 1 件になる。待機中は DB 接続を 1 本保持し、取得が多いと API の待ち時間も延びる。本人用 API に投入上限を置き、同期はキューで待つ。1 秒は開始間隔の下限より保守的に、受信完了から数える。

サービスはキャラクター変更のたびに ID トークンを発行し直さず、読み取り API を使える。既存の OIDC クライアント設定を変えるときは運営者が権限を確認する。本番の compose、停止猶予と監視は A1.6 で接続する。

## References

- [ADR-0005](0005-lodestone-character-source.md)、[ADR-0006](0006-character-ownership-and-jobs.md)
- [キャラクター runbook](../runbook/characters.md)
