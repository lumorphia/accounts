# ADR-0009: 旧アカウントの台帳と handle の予約を原子的に扱う

| 項目     | 内容       |
| -------- | ---------- |
| Status   | Accepted   |
| Date     | 2026-10-07 |
| Deciders | t1nyb0x    |

## Context

A1.5 は Prismtone の旧利用者に期限を設けず移行を案内し、旧 handle を本人だけが選べるようにする。メールで突き合わせず、認証済みのプロバイダーの組を使う。引き継ぎ自体は Prismtone が行い、accounts は台帳と共有 handle を管理する。

## Decision

- `legacy_accounts` にサービス・旧利用者 UUID・旧 handle・移行先と日時・handle の選択を持つ。`legacy_identities` にプロバイダー名と ID の組を持つ。サービス内の旧利用者とプロバイダーの組、handle を一意にする。移行先もサービス内で一意にする。
- 取り込みは active 管理者のセッションを使うローカルスクリプトから一度だけ行う。既定は書き込まない確認モード、`--apply` で確定する。台帳の情報を正規化・整列した digest と元の件数を `legacy_imports` に残し、同じ入力の再実行は変更しない。異なる入力は拒否する。
- 受け取るのは必要な列だけ。秘密・メール・表示名・プロフィール・投稿は取り込まない。通常の handle 規則に合わないもの、重複、対応しないプロバイダー、ホストの無い連合型 ID を拒否する。既に無関係な Lumorphia 利用者が旧 handle を持っている場合は全体を rollback する。
- 台帳の取り込み、handle の確定・変更、移行完了、予約解放は同じ PostgreSQL advisory lock を先に取る。利用者の更新はその後で行ロックを取る。予約確認を省いた直接の更新や、取り込みと登録の同時実行でも予約を守る。
- 予約は移行待ちの間だけ有効。現在の連携が台帳の `(provider_id, account_id)` と完全に一致する本人にだけ開く。メールや同じ ID の別プロバイダー・別ホストでは一致しない。開発用連携は対象外。
- 設定と初回設定、ホームで本人だけに案内し、初回設定では旧 handle を候補として選べる。選んだだけでは Prismtone の移行完了にはしない。`profile` scope の ID トークン / UserInfo に `legacy_pending: ["prismtone"]` を載せる。プロバイダーの組は従来どおり専用 scope だけ。
- 完了通知は Prismtone の登録クライアントと本人の access token、専用 `lumorphia:legacy` scope に限る。sub を本文から受けず、台帳との一致を再確認する。旧 handle を使うか現在の handle を保つかは明示的に選択し、通常の30日の変更待機中でも一度だけ旧 handle へ変えられる。
- 同じ移行先と同じ選択の再通知は成功。別の移行先や選択は拒否する。移行後は予約を解放し、最新の UserInfo と案内から引き継ぎ待ちを取り除く。
- Lumorphia 利用者が物理削除されると、移行済みの台帳と連携も cascade で削除する。移行前の Prismtone 利用者が物理削除された場合は管理者用の解放操作を行う。取り込みの digest は残すため、再実行で台帳を復活させない。

## Consequences

handle を更新する少数の操作は DB 全体で順に実行する。取り込み後の旧 handle・連携の変更は台帳へ自動同期しないため、A2 で旧サービスの変更導線と切り替え時の対象を確認する。

Prismtone の投稿・お気に入り・キャラクターの引き継ぎ、利用者の確認画面、完了通知の永続的な再送は A2。RP は自身の DB で移行を確定してから通知し、失敗時は同じ選択で再送する。異なる DB の間に単一のトランザクションは作らない。

## References

- [計画](../plan.md)、[台帳の運用手順](../runbook/legacy-ledger.md)
- [ADR-0008](0008-account-lifecycle-outbox.md)
