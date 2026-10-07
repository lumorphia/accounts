# 旧アカウントの台帳と引き継ぎ案内

A1.5 は取り込み・予約・本人向けの案内・完了通知の受け口を提供する。実際の Prismtone の移行は A2、規約と公開判断は A1.6。A2 の旧新規登録停止と同時に台帳を渡す。この段階では実データを取り込まない。

## 取り込みファイル

JSON の最小形式 (以下は擬似データ):

```json
{
  "service": "prismtone",
  "accounts": [
    {
      "legacyUserId": "00000000-0000-4000-8000-000000000001",
      "handle": "test_old",
      "identities": [{ "providerId": "discord", "accountId": "test-provider-id" }]
    }
  ]
}
```

`providerId` は `discord` / `google` / `twitter` / `misskey` / `mastodon`。X は `twitter` を使い、Misskey / Mastodon は現在保存されている `host:userId` をそのまま使う。ホストや ID を推測・変換しない。複数の連携はすべて含める。

旧利用者の UUID、通常の handle、1つ以上の連携を要求する。余分な列、同じ旧利用者・handle・プロバイダーの組の重複、仮 handle や予約語、未対応のプロバイダーは拒否する。台帳を部分的に取り込まない。仮 ID や開発用連携が残っている場合は、対象から黙って落とさず A2 で取り込み対象と対応を確認する。

Prismtone の DB からの読み取り例 (全利用者と全連携、秘密は選択しない):

```sql
SELECT jsonb_build_object(
  'service', 'prismtone',
  'accounts', coalesce(jsonb_agg(jsonb_build_object(
    'legacyUserId', u.id,
    'handle', u.handle,
    'identities', coalesce(a.identities, '[]'::jsonb)
  ) ORDER BY u.id), '[]'::jsonb)
)
FROM users u
LEFT JOIN LATERAL (
  SELECT jsonb_agg(jsonb_build_object(
    'providerId', provider_id, 'accountId', account_id
  ) ORDER BY provider_id, account_id) AS identities
  FROM accounts WHERE user_id = u.id
) a ON true;
```

出力は権限 0600 の手元のファイルに保存し、公開リポジトリ・Issue・PR・ログには載せない。メール、トークン、プロフィールを追加しない。A2 の切り替えでは新規登録停止後に対象件数を確認し、同じファイルを再実行に使う。

## 確認と確定

発行元と同じ `DATABASE_URL`、`AUTH_SECRET`、`AUTH_BASE_URL` を使う。現在の active 管理者の Cookie を `LEGACY_ADMIN_COOKIE` 環境変数に渡す。Cookie を引数やログに書かない。

```sh
pnpm db:migrate
# 既定は確認だけ。形式と既存の handle の衝突を検査する
node --env-file-if-exists=.env scripts/legacy-ledger.ts --input /path/to/ledger.json
# 対象を確認したあとで確定する
node --env-file-if-exists=.env scripts/legacy-ledger.ts --input /path/to/ledger.json --apply
```

出力は `applied`、元の件数 `imported`、同じ取り込みの再実行かを示す `repeated`。provider ID・旧 UUID・handle・digest・認証情報は出力しない。エラーは入力内容を表示しない共通のメッセージにする。

同じ入力は、配列や列の順序が違っても再実行できる。移行や物理削除が済んだ台帳を作り直さない。違う入力は拒否する。確認後から確定までに handle の衝突が増えた場合は、確定も全体を rollback する。無関係な利用者の既存 handle を運営者が勝手に変更して通さない。

## 案内と予約

`GET /api/me/legacy` は pending または active の本人セッションで使う。返すのは `service` / `handle` / `migrationUrl` だけ。`no-store`。プロバイダーの組と旧 UUID は本人画面にも返さない。

初回設定では旧 handle を選ぶボタンを表示し、設定・ホームでは Prismtone へのリンクを表示する。旧 handle を使っただけでは移行完了にならず、案内と予約は維持する。移行期限は無い。リンク先は `LEGACY_PRISMTONE_MIGRATION_URL` (既定 `https://prismtone.lumorphia.com/settings/migration`)。A2 で実際の画面を公開するときに合わせる。

`profile` scope の ID トークンと最新の UserInfo は `https://lumorphia.com/legacy_pending` を返す。移行待ちの一致があれば `["prismtone"]`、完了後は `[]`。Scenote はこの claim を見て同じ案内を出し、Prismtone の DB を参照しない。

予約は現在の認証済み連携で一致する本人だけが取得できる。空き確認だけでなく、初回設定とプロフィール更新でも確認する。メールアドレスの一致を本人確認に使わない。

## Prismtone からの完了通知

新しく登録する Prismtone クライアントだけに `lumorphia:legacy` scope を付ける。既存クライアントには自動で足さないので、A2 で運営者が登録・設定を確認する。認可要求にもこの scope が必要。

利用側の `@lumorphia/auth-client` 設定は、通常の検証・PKCE を維持して要求 scope を追加する:

```ts
const provider = createLumorphiaOAuthConfig({
  issuer,
  clientId,
  clientSecret,
  identities: true,
});
const migrationProvider = {
  ...provider,
  scopes: [...(provider.scopes ?? []), "lumorphia:legacy"],
};
```

`POST /api/legacy/prismtone/complete` はサーバー間の入口で、同じ本人の Bearer access token を送る。Cookie と Origin は使わない。ID トークンや別サービスのトークンは受け付けない。本文は次の2項目だけで、sub を指定できない:

```json
{
  "legacyUserId": "00000000-0000-4000-8000-000000000001",
  "handleChoice": "legacy"
}
```

`handleChoice` は旧 handle を使う `legacy`、現在の Lumorphia handle を使う `current`。旧 handle の採用は通常の変更待機中でも一度だけ行える。実際に handle を変更した場合は通常の30日の変更待機を開始する。現在の handle を保つ場合は待機日時を変えない。応答は `handle` と `alreadyCompleted`。

A2 の Prismtone は、先に本人に何を引き継ぐかと handle の選択を確認し、自分の DB の本人照合・一意性・BAN・投稿・お気に入り・キャラクターの処理を確定する。移行結果と accounts への通知要求を同じ RP トランザクションに保存し、commit 後に通知する。失敗した通知は同じ旧 UUID と選択で再送する。accounts では同じ移行先・同じ選択の再送を成功として返し、別の利用者や別の選択は拒否する。

通知後は UserInfo または次のログインで最新の handle と `legacy_pending` を読む。既に発行した ID トークン自体の内容は変わらない。サービスの role、BAN、規約同意は引き継ぎ元・サービス自身で管理する。

## 旧サービスの物理削除による解放

移行前の Prismtone 利用者を物理削除したことを確認してから、現在の管理者が予約と台帳を解放する。30日の復旧期間中には行わない。

```sh
node --env-file-if-exists=.env scripts/legacy-ledger.ts --release <legacy-user-uuid> --apply
```

操作は冪等。取り込み記録が残るため、同じファイルを再実行しても台帳は復活しない。A2 の旧ログインだけによる退会とこの操作の接続は、切り替え時に運用へ組み込む。移行済みの Lumorphia 利用者は、全体退会後の物理削除で台帳と連携も cascade で消える。
