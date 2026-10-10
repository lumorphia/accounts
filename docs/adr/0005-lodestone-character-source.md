# ADR-0005: Lodestone のキャラクター取得を accounts に置く

| 項目     | 内容       |
| -------- | ---------- |
| Status   | Accepted   |
| Date     | 2026-10-07 |
| Deciders | t1nyb0x    |

## Context

A1.3 でキャラクターの登録・本人確認・再同期を accounts に移す。Prismtone はキャラクター取得と装備の入手先取得を同じ Lodestone アダプターで行っている。accounts は装備や投稿を扱わず、サービスがキャラクターを取り直すと取得が重複する。

## Decision

- `packages/core/src/adapters/lodestone/` にキャラクター検索とプロフィール取得だけを移す。HTML の解析は `selectors.ts`、HTTP は `http.ts`、テスト用の情報源は `fake.ts`。サービスには A1.3c の一覧 API から渡す。
- 種族と性別のコードは Prismtone と同じ値を保つが、Prismtone のパッケージには依存しない。ワールドと DC は Lodestone の表示から読み取り、固定の一覧とは照合しない。新しい DC が表示されても取得を止めない。表示形式が変わったときは `parse_error`。
- 同時取得は 1 件、開始間隔は 1 秒以上、1 回の取得は 10 秒まで。429 と 5xx、ネットワーク失敗は最大 2 回再試行。404 とほかの 4xx は再試行しない。検索とプロフィールは同じ順番待ちを使う。
- 自己紹介は本人確認のための一時的な戻り値だけ。後続のドメインで本文を DB に保存しない。画像は URL を読むだけで、自前コピーしない。
- fixture は Prismtone の運営者のキャラクター (15022394) から、解析に使う部分だけを残す。ほかのプレイヤーの情報を含むランキングなどは削り、除外のテストには架空の項目を使う。旧サービスの確認文字列は架空の文面に置き換える。
- HTTP の差し替え先や間隔の設定はテストとサーバーの設定用。利用者の入力から取得先 URL を決めない。本番への接続時には連絡先を含む User-Agent を設定する。

## Consequences

Lodestone の取得を accounts に集め、サービス側の DB・投稿・装備から独立してテストできる。HTML の変更による失敗は引き続きあり、fixture とセレクタを更新する必要がある。HTTP インスタンスごとの順番待ちなので、A1.3b の API と worker の接続時に取得の経路を整理する。

## References

- [計画 A1.3](../plan.md)
- prismtone ADR-0013、docs/design/12-character-linking.md
