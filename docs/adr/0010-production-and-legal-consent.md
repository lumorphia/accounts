# ADR-0010: 本番の分離、規約の同意と worker の監視

| 項目     | 内容       |
| -------- | ---------- |
| Status   | Accepted   |
| Date     | 2026-10-07 |
| Deciders | t1nyb0x    |

## Context

A1.6 はアカウントの公開前の準備を行う。同じ VPS の Prismtone を動かしたまま、共通規約への同意、worker の停止、非同期の削除・配送の滞留を確認できる必要がある。

## Decision

- PostgreSQL とバックエンドの Docker network は accounts 専用。既存の Caddy だけを外部の `lumorphia-edge` に接続し、web のみ参加させる。accounts 側ではホストのポートを公開しない。worker は外部への取得・配送のため通常の bridge network を使う。
- web、キャラクター worker、退会 worker、migration は同じ固定コミットのイメージ。非 root の Node で実行する。npm の秘密は BuildKit secret で渡す。バックアップは専用イメージと認証を持つ。
- 共通の利用規約とプライバシーポリシーを公開ルートで表示する。各サービスの規約・同意・BAN とは分ける。
- 初回設定は現在の2文書の版と15歳以上の確認を必須にする。同意日時はサーバーが生成し、アカウントの active 化と同じトランザクションで保存する。生年月日は取らない。初回の版は1.0。開発用ログインの自動設定だけはテスト用の同意を与える。
- worker は30秒ごとに DB に心拍を保存する。機能が有効な worker の心拍が無い、無効、2分以上前、未来の時刻なら `/api/health` は503。機能が無効なら disabled として区別する。健康な心拍だけで処理の成功とは扱わず、別に削除・配送・取得の滞留を監視する。
- 各 worker は1コンテナで動かす。複数 replica や重なる更新には対応せず、古いコンテナの終了後に次を開始する。終了時は進行中の処理と心拍の書き込みを待ち、心拍を消してから DB を閉じる。
- 本番の公開判断と main の昇格は別の操作。develop の merge や PR のイメージ検証では公開しない。GHCR への公開は main に対する手動 workflow で、固定の sha タグを作る。doco-cd の登録も公開判断後。

## Consequences

worker の起動までは web が healthy にならないため、worker は web の healthy を待たず migration 完了から起動する。health の503は web の自動再起動を意味しない。Playwright は worker の常駐を前提としないため、web の起動待ちは `/api/me` を使う。

規約の重要な改定時は本文と版を更新するだけでは足りない。既存の active 利用者へ再同意を求める導線と認可の制御を先に実装して公開する。現在の1.0は初回公開で、既存本番の Lumorphia アカウントは無い。公開前には同意のない active 行が無いことを確認する。

## References

- [ADR-0002](0002-stack-hosting-and-visibility.md)、[ADR-0008](0008-account-lifecycle-outbox.md)
- [公開判断](../runbook/release.md)、[本番運用](../runbook/deploy.md)
