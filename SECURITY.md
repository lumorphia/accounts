# セキュリティ

Lumorphia アカウントは、Lumorphia のサービス (Prismtone、Scenote) のログインとキャラクターを受け持ちます。

## 弱点を見つけたら

**Issue や Pull Request には書かないでください。** このリポジトリは公開されているので、直す前に手口が知られてしまいます。

GitHub の [非公開の報告 (Report a vulnerability)](https://github.com/lumorphia/accounts/security/advisories/new) から知らせてください。運営者だけが読めます。

- 何が起きるか、どうすれば再現できるか
- 影響を受ける範囲 (アカウント、セッション、キャラクター、つながっているサービス)

受け取ったら、まず受け取ったことをお返しします。直して本番に入れてから、内容を公開します。

## 運営者の手順

1. 報告や自分で見つけた弱点は、Issue にせず、[セキュリティアドバイザリ](https://github.com/lumorphia/accounts/security/advisories) の下書きにする
2. アドバイザリの **一時的な非公開の fork** で直す。テストもそこで書く。公開のブランチや PR には出さない
3. 本番に入れる (非公開の fork から main にマージし、リリースする)
4. 鍵やトークンが漏れた可能性があれば、消すより先に作り直す (`AUTH_SECRET`、OAuth のクライアントシークレット、署名の鍵、サービスのクライアントシークレット)
5. 本番に入ったことを確かめてから、アドバイザリを公開する。影響を受けた利用者がいれば知らせる

つながっているサービス (lumorphia/prismtone、lumorphia/scenote) と、共通の基盤 (lumorphia/platform) の弱点も、同じ手順で扱います。
