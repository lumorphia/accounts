# ADR-0014: ブランド画面とトップへのログイン導線

| 項目     | 内容       |
| -------- | ---------- |
| Status   | Accepted   |
| Date     | 2026-10-10 |
| Deciders | t1nyb0x    |

## Context

Lumorphia は Prismtone と異なるブランドとして、落ち着いた藍色・余白・既存の光のロゴでトップとアカウント画面を揃える。通常ログインの後に専用のダッシュボードは必要なく、トップのヘッダーからアカウントを管理できればよい。

## Decision

- `website` はトップを配信し、`accounts` はログイン・初回登録・アカウント管理・規約・復旧を提供する。通常ログインのローカルな戻り先 `/` で状態を確認し、active の利用者は `WEBSITE_ORIGIN` のトップに移る。pending は初回登録、deleted は本人の復旧確認へ進む。
- 署名付き OIDC 認可要求と検証済みのローカルな `next` は既存の処理を維持する。サービスからのログインをトップへの移動で中断しない。
- トップは `GET /api/website/session` を credentials 付きで呼ぶ。この入口だけに、設定済みの単一 HTTPS オリジンの CORS を許可する。active の表示名・handle・アイコンだけを返し、private/no-store と Vary: Origin を付ける。Cookie の Domain を広げず、変更 API の CORS も広げない。
- トップのメニューはアカウント管理とログアウト、管理画面のメニューはトップとログアウト。PC はアイコンと表示名、スマートフォンはアイコンだけ。管理のページ名は「アカウント管理」、画面の handle は「ユーザーID」とする。
- トップのログアウトは `POST /logout` のフォーム。Accounts または設定済みトップからの Origin だけを許可し、認証の sign-out を実行して Cookie を消し、固定のトップへ303で戻す。GETでは状態を変えない。任意の戻り先を受け付けない。
- 両サイトのテーマは端末の設定を初期値にし、利用者が選んだ値は各オリジンの localStorage に保存する。アカウント情報としては保存しない。
- X のプロバイダー設定と既存データは残す。運用では AUTH_X_ID / AUTH_X_SECRET を設定せず、ログインと新規連携に表示しない。E2Eでは既存の対応を検証するため有効にする。
- 初回登録は表示名・ユーザーID・規約への同意・年齢確認に絞る。アイコンは管理画面で設定する。15歳以上の説明は FFXIV の公式利用規約の年齢条件に合わせていることを示す。

## Consequences

website と accounts を一緒に配信して初めてログイン後のヘッダーが動く。website の CSP は Accounts への connect-src と form-action、戻り先となる self を許可する。Accountsの停止時もトップは表示でき、ヘッダーは通常のログインリンクを出す。

テーマは別オリジンで個別に保存するため、手動選択は他方へ自動同期されない。実画面のPC・390px・320px、両テーマと長い表示名をE2Eで確認する。

## References

- [採用した試作](../design/previews/lumorphia-brand/README.md)
- [FFXIV利用規約](https://support.jp.square-enix.com/rule.php?id=5381&tag=users)（2026-10-10確認）
- [ADR-0011](0011-explicit-recovery.md)、[ADR-0004](0004-logout-confirmation-form-csp.md)
