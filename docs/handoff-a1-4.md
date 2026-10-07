# 引き継ぎ: A1.4 (退会と復旧)

2026-10-07。A1.3c は accounts PR #12 で develop に取り込み済み。

accounts の `feat/a1-4-account-lifecycle` と platform の `feat/account-lifecycle` で、本人の設定画面、退会 2 種類、厳密な 30 日未満の復旧、物理削除、永続的な画像削除と通知の再送を追加した。判断は [ADR-0008](adr/0008-account-lifecycle-outbox.md)、起動と受信側の契約は [runbook](runbook/account-deletion.md)。

通知は既存の EdDSA / JWKS 鍵を使い、試行ごとに短い JWT を署名する。サービスの revision と変わらない eventId で順序と重複を扱う。platform の `@lumorphia/auth-client` に受信・検証器を足し、ログイン時は UserInfo でも現在の active 状態を確かめる。

ドメイン・API・再送・画像キーの再使用・アップロードと退会の競合は red を確認してから実装した。worker の毎分スケジュールと無効時の保留は、ガードの変更を検出することも確認した。HTTPS E2E は全体退会と同じ ID への復旧、独立したサービス退会と復旧、署名を検証する実際の TLS 受信先が一度失敗した後の削除→復旧の再送を扱う。

既定の `FEATURE_ACCOUNT_LIFECYCLE=0` は維持する。本番での有効化と compose / 監視は A1.6、Prismtone と Scenote の DB アダプターと期限切れデータの処理は A2 / A3 で接続する。次の段階は A1.5 (旧アカウントの台帳、handle の予約、引き継ぎの案内)。

`docs/handoff-a1-1.md` は開始時点からある未追跡ファイルで、この変更には含めない。

検証: 単体・PostgreSQL テスト 360 件、HTTPS E2E 27 件。lint・format:check・typecheck とビルドも成功。platform は全体 204 件成功、ローカル RustFS が無いため既存 S3 結合テスト 5 件は skip (CI では必須)。
