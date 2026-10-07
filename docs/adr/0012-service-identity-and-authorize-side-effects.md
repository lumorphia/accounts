# ADR-0012: サービスはクライアントの metadata で見分け、状態の変更は認可の入口で行う

| 項目     | 内容       |
| -------- | ---------- |
| Status   | Accepted   |
| Date     | 2026-10-07 |
| Deciders | t1nyb0x    |

## Context

これまでは、OAuth クライアントがどのサービスのものかを、場所ごとに違う方法で見分けていた。

- 退会の通知、トークンの失効、利用先の推定、キャラクター API、移行の完了通知は `client_name` (表示名) を見ていた
- 認可コードの交換は `metadata.lumorphia_service` を見ていた

表示名を変えると、退会の通知とトークンの失効が黙って外れる。そうなると、規約で約束したサービス側のデータ削除が行われない。サービスの一覧も 3 か所に別々に書かれていた。

また、`customIdTokenClaims` (ID トークンの claim を作る処理) の中で `visitService` を呼んでいた。そのため、トークン発行の途中でサービスの再開や削除済みの通知が起き、発行が失敗しても状態だけが変わりえた。

サーバー間の API (キャラクター一覧、移行の完了) は、Bearer を確かめる処理を別々に書き写していた。同じ中身の内部エンドポイントも 2 つあった。

## Decision

- サービスは `metadata.lumorphia_service` だけで見分ける。見分け方とサービスの一覧は `packages/core/src/domain/services.ts` だけに置く。`client_name` は表示名として扱い、判定には使わない
- Better Auth は metadata を JSON 文字列のまま jsonb に保存するため、SQL の `->>` では読めない。クライアントは数件なので、全件を読んで JS で絞り込む (`clientsOfService`)
- サーバー間 API の Bearer の確認は `apps/app/server/auth/service-access.ts` の `requireServiceAccess` 一つにまとめる。内部の口も `serviceAccess` の一つ (serverOnly) にする
- 状態の変更は認可の入口 (`authorizeGate`、`/oauth2/authorize` の before hook) で行う。ここで退会中なら復旧を選ばせ (ADR-0011)、そうでなければ `visitService` で利用を記録する。初回設定前 (pending) の利用者は、`/welcome` から認可に戻ったときに記録する
- `customIdTokenClaims` は状態を読むだけにする。認可のあとにそのサービスを退会していれば `service_deleted` で発行を拒む

## Consequences

- 表示名を変えても、通知・失効・API の権限は変わらない。`lumorphia_service` の無いクライアントは、名前がサービス名と同じでもサービスとして扱わない
- 認可要求がその後のクライアントの検証で失敗しても、利用の記録 (`service_memberships`) は残ることがある。記録が残ると、退会の通知がそのサービスへ届く。サービス側は知らない `sub` の通知を無視するので、害はない
- ADR-0011 の「サービスの退会は `visitService` が `service_deleted` で拒む」は、トークン発行時の読み取りでの確認に置き換える
