# 引き継ぎ: A1.3 (キャラクター)

2026-10-07。accounts の A1.2 と platform の `@lumorphia/auth-client` は develop に取り込み済み。

## 分け方

- **A1.3a**: Lodestone のキャラクター検索・プロフィール取得・HTML 解析・テスト用の情報源。`feat/a1-3a-lodestone`。取得間隔・同時取得・再試行を fixture と偽の HTTP で確認する。本番の Lodestone へはテストでアクセスしない。
- **A1.3b**: characters のスキーマ、登録・本人確認 (`lumorphia-xxxxxxxx`、24 時間)、トークン再発行、主キャラクターと削除、再同期とジョブ。Prismtone の投稿や OGP の処理は移さない。認証済み Lodestone ID の一意性と同時操作も DB テストで確かめる。
- **A1.3c**: 本人用の設定画面と API、登録したサービス向けの一覧 API、fixture を使う HTTPS の E2E。OIDC の access token と必要な scope を検証し、確認トークンや自己紹介をサービスへ渡さない。

## A1.3a の範囲

`@lumorphia-accounts/core/adapters/lodestone` から `LodestoneSource`・`HttpLodestoneSource`・`FakeLodestoneSource` と型を使う。Prismtone の種族コードは維持し、サービスのパッケージには依存しない。装備とコンテンツの取得は移していない。判断は [ADR-0005](adr/0005-lodestone-character-source.md)。

fixture は運営者のページから必要な部分だけに縮め、ほかのプレイヤーの情報と旧サービスの確認文字列を除いた。自己紹介は一時的な戻り値で、ドメインへ接続するときにも保存しない。

確認: lint・format:check・typecheck 成功。単体と PostgreSQL の DB テストは全体 229 件、Lodestone のテストは 34 件成功。全体の行カバレッジ 89.37%、branch 76.43%。初めに HTTP と解析のテストを実装のない状態で失敗させ、本文の受信失敗の再試行も失敗を確認してから通した。HTML fixture は実行コードではないためカバレッジの対象から外す。画面と API の接続は後続の段階。

次は A1.3a の CI が緑になってから develop に Rebase and merge し、A1.3b に進む。`docs/handoff-a1-1.md` は開始時点からある未追跡ファイルなので、この変更には含めない。
