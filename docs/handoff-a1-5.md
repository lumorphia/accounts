# 引き継ぎ: A1.5 (旧アカウントの台帳)

2026-10-07。accounts の A1.4 は [PR #13](https://github.com/lumorphia/accounts/pull/13)、platform の受信側は [PR #11](https://github.com/lumorphia/platform/pull/11) で develop に取り込み済み。

`feat/a1-5-legacy-ledger` で、最小の JSON 台帳の一度だけの取り込み、handle の本人用予約、引き継ぎ待ちの claim、初回設定・設定・ホームの案内、Prismtone からの完了通知を追加した。判断は [ADR-0009](adr/0009-legacy-ledger-and-handle-reservations.md)、操作と A2 の契約は [runbook](runbook/legacy-ledger.md)。

現在の active 管理者だけがスクリプトから取り込める。既定は書き込まない確認、`--apply` で確定。同じ入力の再実行は冪等で、削除・移行済みの台帳を再作成しない。旧利用者 ID と移行先はサービス内で一意にする。プロバイダーと ID の組で本人を確認し、メールでは照合しない。

handle の予約は空き確認、初回設定、プロフィール変更で共通に確認する。取り込みと handle の更新は同じ advisory lock で順序づける。旧 handle の採用と現在の handle の維持を明示的に選び、完了通知の sub は Bearer token からのみ決める。新しい `lumorphia:legacy` scope は Prismtone にだけ登録する。

台帳・予約・移行完了、入力検証・書き込まない確認、管理者操作・API・専用 scope、案内の HTTPS E2E を red で確認してから実装した。検証は単体・PostgreSQL 全体389件 (新規29件)、HTTPS E2E全体29件 (新規2件)。lint・format:check・typecheck・ビルドも成功。行90.89%、branch80.97%。

実データの取り込みや本番 DB は触っていない。A2 で旧新規登録を止め、対象件数と仮 ID・旧連携の扱いを確認してから台帳を渡す。Prismtone の移行確認画面、投稿・お気に入り・キャラクターの引き継ぎと完了通知の再送は A2。`LEGACY_PRISMTONE_MIGRATION_URL` を実際の画面に合わせる。

次は A1.6 (規約・プライバシーポリシー、本番 compose と runbook、監視、公開判断)。開始時からある未追跡の `docs/handoff-a1-1.md` はこの変更に含めない。
