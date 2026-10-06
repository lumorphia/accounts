# Lumorphia アカウント 計画

## Context

Lumorphia のサービスが増える (Prismtone、Scenote、Facetia)。サービスごとにアカウント登録させるのは利用者の手間が大きく、Lodestone のキャラクター確認もサービスごとにやり直すことになる。アカウントとキャラクターを Lumorphia の層に置き、各サービスはそれを使う。

Prismtone はすでに公開していて、運営者を含めて 3 人の利用者がいる。この人たちが投稿・お気に入り・確認済みのキャラクターを失わずに移れる手段を用意する。

## 決めたこと (2026-10-06、t1nyb0x)

- アカウントは Lumorphia で 1 つ。handle も Lumorphia で 1 つ
- Lodestone の確認は Lumorphia で行い、トークンは `lumorphia-xxxxxxxx`
- Prismtone の利用者には移行の手段を用意する
- 新しく使う人は Lumorphia アカウントで登録する。Prismtone 単独の新規登録は、A2 の公開と同時に止める
- 既存の Prismtone 利用者には移行してもらう。案内は手厚くする。**移行期限は設けない**
- Scenote などほかのサービスを使おうとした Prismtone 利用者には、Prismtone アカウントの移行を案内する
- 退会は「サービスごと」と「Lumorphia から」の 2 種類。どちらもサービスのデータを消す。30 日の復旧を持たせる
- 認証の発行元は spike (A0) で決める → Better Auth の oauth-provider に決まった

## 1. 形

```text
accounts.lumorphia.com   Lumorphia アカウント (lumorphia/accounts)
  ├─ ログイン            Discord / Google / X / Misskey (MiAuth) / Mastodon。ここだけが持つ
  ├─ 利用者              handle、表示名、アイコン
  ├─ キャラクター        Lodestone の確認と再同期 (トークン lumorphia-xxxxxxxx)
  ├─ OIDC の発行元       各サービスはここに「Lumorphia でログイン」する
  └─ API                 キャラクター一覧など、サービスが読むもの
        │
  ┌─────┴─────┐
Prismtone    Scenote     自分のセッション、投稿、お気に入り、規約の同意、BAN、bio
```

- 各サービスは OIDC の利用側 (Relying Party)。セッションはサービスごとに持ち、DB も別のまま (Scenote ADR-0002)
- サービスの利用者表は Lumorphia の `sub` を鍵に持つ。サービスの中の ID は外に出さず、URL は handle
- `.lumorphia.com` の Cookie 共有はしない
- 認証の発行元は Better Auth 1.7.7 + `@better-auth/oauth-provider` 1.7.7。サービス側は Better Auth の `generic-oauth`。A0 の spike で決めた (`spikes/a0-oidc/README.md`)
- 開発と E2E も https と `*.lumorphia.test` のホスト名で組む (web クライアントの redirect URI は https かつループバック以外に限られる)
- ログアウトは OIDC の end-session と back-channel logout。退会の知らせは back-channel では送らない (1 回しか送らないため)

### どこに置くか

| もの                                   | 置き場所  | 理由                                                                      |
| -------------------------------------- | --------- | ------------------------------------------------------------------------- |
| ログインに使うプロバイダーの連携       | Lumorphia | ログインは 1 か所                                                         |
| handle、表示名、アイコン               | Lumorphia | 同じ人だと分かるように                                                    |
| キャラクターと Lodestone の確認        | Lumorphia | Lodestone を見に行くのを 1 か所に (Prismtone ADR-0013 の「取得は最小限」) |
| bio、投稿の既定値 (投稿者を非公開など) | サービス  | サービスで意味が違う                                                      |
| 規約の同意                             | 両方      | Lumorphia アカウントの規約と、サービスの規約は別                          |
| 管理者、BAN                            | サービス  | 片方での BAN が、もう片方を止めない                                       |
| 退会                                   | 両方      | 「このサービスだけ」と「Lumorphia から」の 2 種類                         |

## 2. Prismtone からの移行

### 仕組み: 同じプロバイダーの ID で突き合わせる

Prismtone の `accounts` は (`provider_id`, `account_id`) を持つ。この値はプロバイダー側の利用者の ID で、ログインするアプリが変わっても同じ。

| プロバイダー | account_id          |
| ------------ | ------------------- |
| Discord      | Discord の利用者 ID |
| Google       | `sub`               |
| X            | X の利用者 ID       |
| Misskey      | `{host}:{userId}`   |
| Mastodon     | ホストと利用者 ID   |

Lumorphia の ID トークン (または userinfo) に、その人が連携しているプロバイダーの組を載せる (サービスにだけ渡す専用の scope)。Prismtone はログインのたびに、知らない `sub` が来たらその組で自分の `accounts` を探す。

```text
旧 Prismtone 利用者が「Lumorphia でログイン」
  → Lumorphia で Discord ログイン (初めてなら Lumorphia アカウントができる)
  → Prismtone に戻る。sub は Prismtone で未登録
  → identities の (discord, 1234) が Prismtone の accounts にある
  → 「この Prismtone アカウントを引き継ぎますか」(handle、投稿数を見せる)
  → 引き継ぐ: users.lumorphia_sub を埋める。投稿・お気に入り・キャラクターはそのまま
```

- メールアドレスでは突き合わせない (Prismtone ADR-0004)
- 引き継ぎは本人の確認を 1 回挟む。黙って結び付けない
- 1 つの Prismtone 利用者に結び付く Lumorphia アカウントは 1 つ (`lumorphia_sub` を一意)
- 見つからなければ、新しい Prismtone の利用者として始める

### handle

- Prismtone の handle は、引き継いだ本人だけが Lumorphia で取れる (下の「旧アカウントの台帳」)。期限は無いので、予約は引き継ぐか Prismtone を退会するまで続く
- 引き継ぎのとき、Prismtone の handle を Lumorphia の handle にする。すでに Lumorphia で別の handle を決めていたら、どちらにするかを選ばせる

### 旧アカウントの台帳

Prismtone 単独の新規登録を止めた時点で、旧アカウントはそれ以上増えない。そこで、止めるのと同時に Prismtone から Lumorphia へ一度だけ台帳を渡す。

| 列                      | 内容                             |
| ----------------------- | -------------------------------- |
| service                 | `prismtone`                      |
| provider_id, account_id | Prismtone の `accounts` の全行   |
| legacy_user_id          | Prismtone の利用者 ID            |
| handle                  | Prismtone の handle (予約に使う) |
| migrated_at             | 引き継いだら埋める               |

- Lumorphia は、ログインした人のプロバイダーの組が台帳にあれば「Prismtone のアカウントが見つかりました」と案内し、handle の予約をその人に開く
- ID トークンに「引き継ぎ待ちのサービス」(`legacy_pending: ["prismtone"]`) を載せる。Scenote などはこれを見て「Prismtone のアカウントを引き継ぎましょう」と案内する。Scenote は Prismtone の DB を見ない
- 引き継ぎそのものは Prismtone の画面で行う (Prismtone のデータを動かすのは Prismtone だけ)。終わったら Prismtone が Lumorphia に知らせ、`migrated_at` を埋める
- 台帳は Prismtone のプライバシーポリシーの改定が要る (Lumorphia に渡す情報が増える)

### 案内

- Prismtone の旧ログインで入った人: 毎回、引き継ぎの帯 (閉じられるが、次のログインでまた出す)。設定ページに引き継ぎの手順
- Lumorphia で新しく登録した人が台帳に当たったとき: 登録の直後に「Prismtone のアカウントが見つかりました。引き継ぐと投稿とキャラクターがそのまま使えます」と引き継ぎの入口
- Scenote などで `legacy_pending` を受け取ったとき: 初回の画面で同じ案内
- 引き継ぎ画面: 何が移るか (投稿、お気に入り、キャラクター、handle) と、何が移らないか (ほかに連携していたプロバイダー。あとから連携し直す) を先に見せる
- 運営者から既存の 2 人に直接知らせる

### キャラクター

- Prismtone で確認済みのキャラクターは、引き継ぎのときに Lumorphia へ移し、確認済みのまま扱う。確認したのは自分たちのシステムなので、やり直させない
- 未確認のキャラクターも移す。新しく確認するときは `lumorphia-` のトークン
- Prismtone の `characters` は Lumorphia のキャラクター ID を参照する形に変える。`posts.character_id` の付け替えは引き継ぎと同じトランザクションで

### 連携していた別のプロバイダー

Prismtone で Discord と Misskey の両方を連携していた人は、Lumorphia でログインした 1 つしか自動では分からない。残りは Lumorphia の設定から連携し直してもらう (画面で案内する)。Prismtone からプロバイダーの連携を Lumorphia に流し込むことはしない。

### 切り替えの段取り

1. Lumorphia アカウントを公開する (A1)
2. Prismtone に「Lumorphia でログイン」と引き継ぎを足し、同時に旧ログインでの新規登録を止めて台帳を渡す (A2)
3. 旧ログインは、既存の利用者がログインするためだけに残す。期限は設けない
4. 引き継ぎが全員済んだら、旧ログインを外すかを改めて決める

利用者は 3 人で、運営者から 2 人に直接知らせられる。それでも仕組みは省かない。あとから合流するサービスでも同じ手順を使うため。

## 3. 退会

| 種類           | 直後                                                                                         | 30 日以内に再ログイン                       | 30 日後                                                       |
| -------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------- | ------------------------------------------------------------- |
| サービスだけ   | そのサービスで非表示。セッションを消す。画像の削除を始める                                   | そのサービスの ID・プロフィール・連携が戻る | そのサービスのデータを物理削除                                |
| Lumorphia から | Lumorphia と全サービスで非表示。全サービスのセッションを消す。全サービスで画像の削除を始める | Lumorphia とすべてのサービスが戻る          | Lumorphia (キャラクターを含む) と全サービスのデータを物理削除 |

- 画像は退会の時点で削除を始めるので、復旧しても戻らない (Prismtone ADR-0019 と同じ。Prismtone 規約 8 章にもそう書いてある)。復旧で戻るのは ID・プロフィール・連携・投稿の文字情報
- Lumorphia からの退会は、Lumorphia が各サービスに「退会した」「復旧した」「消した」を知らせる。届くまで送り直す (Lumorphia 側に送信待ちの表を置き、pg-boss で送る)。サービスは受け取ったら、自分の 30 日の処理に乗せる
- サービスは、知らせが届かなかったときのために、ログインのたびに Lumorphia の状態も確かめる
- サービスだけの退会では、Lumorphia のアカウントとキャラクターは残る

## 4. 段階

| 段階 | 内容                                                                                                                         |
| ---- | ---------------------------------------------------------------------------------------------------------------------------- |
| A0   | 済み (2026-10-06)。`spikes/a0-oidc/`。残り: back-channel の配送、鍵の更新、PostgreSQL で動かすこと (A1 で)                   |
| A1   | lumorphia/accounts の本体。下の A1.0〜A1.6 に分ける                                                                          |
| A2   | Prismtone: OIDC の利用側、引き継ぎ、handle の予約、キャラクターの付け替え、旧ログインの段階的な廃止。Prismtone に ADR を足す |
| A3   | Scenote: 最初から Lumorphia でログイン (S4 の認証はこれに置き換わる)                                                         |

Scenote の S1 (`@lumorphia/media`) と S2 (骨組み) は A0〜A2 と並行できる。Scenote の S4 (投稿) は A1 を待つ。

### 4.1 A1 の段階

決めたこと (2026-10-07、ADR-0002): リポジトリは public。Prismtone と同じ VPS で動かし、Postgres は別のコンテナにする。表示名とアイコンは Lumorphia で 1 つ (自己紹介だけサービスごと)。画面は Prismtone の部品を写して始め、Lumorphia のデザインはあとで整える。

| 段階 | 内容                                                                                                                                                                                                                                                                                                                  | 移すもの (prismtone) / 使うもの                                                                                                                                                                                                                         |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1.0 | 骨組み。React Router (SSR) + Fastify + Drizzle + PostgreSQL + pg-boss + Better Auth。開発と E2E は https と `*.lumorphia.test` (A0 の発見 1)。CI、release-please、Docker                                                                                                                                              | prismtone の構成 (scenote ADR-0002 と同じ)、platform の `ops`                                                                                                                                                                                           |
| A1.1 | ログイン 5 種、handle の確定、表示名とアイコン、セッション、開発用ログイン、表示名の更新                                                                                                                                                                                                                              | `apps/app/server/auth/` (auth・miauth・mastodon・miauth-host・account-display-name・refresh-account-profiles・dev-login・oauth-mock-fetch)、`domain/users.ts` の handle まわり (prismtone ADR-0017)、`domain/avatar.ts`。platform の `media`・`storage` |
| A1.2 | OIDC の発行元。トークン・introspect・revoke の入口は CSRF の Origin 確認から外す (サービスのサーバーから Origin なしで来る。クライアントの認証で守る)。クライアントを登録するスクリプト、ID トークンと userinfo の claim (`handle`、`legacy_pending`、`identities` は登録したクライアントだけ)、鍵の更新、end-session | A0 の spike。同時に platform に `@lumorphia/auth-client` (サービス側の受け口) を作る                                                                                                                                                                    |
| A1.3 | キャラクターと Lodestone の確認 (トークン `lumorphia-`)、再同期、サービス向けのキャラクター一覧 API                                                                                                                                                                                                                   | `domain/characters.ts`、`adapters/lodestone/`、`jobs/character-verify.ts`・`character-sync-all.ts`、`e2e/mock-lodestone.ts`                                                                                                                             |
| A1.4 | 退会 2 種類 (サービスごと・Lumorphia から)、30 日の復旧、物理削除、サービスへの知らせ (送信待ちの表 + 送り直し)                                                                                                                                                                                                       | `domain/account-deletion.ts`、`jobs/account-purge.ts` (prismtone ADR-0019)                                                                                                                                                                              |
| A1.5 | 旧アカウントの台帳 (取り込み、handle の予約、`legacy_pending`)、引き継ぎの案内                                                                                                                                                                                                                                        | 新規 (2 章)                                                                                                                                                                                                                                             |
| A1.6 | 規約とプライバシーポリシー (2 層、6 章)、本番の compose と runbook、監視、公開の判断                                                                                                                                                                                                                                  | prismtone の `docs/legal`、`docs/runbook`                                                                                                                                                                                                               |

- 各段階で、移したものの単体テスト・DB テストを一緒に移し、E2E は A1.0 で作る https の土台の上で回す
- `@lumorphia/auth-client` は A1.2 で作り、A2 (prismtone) と A3 (Scenote) が使う。退会の知らせの受け口も A1.4 でここに足す

## 5. 確かめ方

- A0: spike のリポジトリで、ログイン → サービスへ戻る → ID トークンの検証 → identities の受け取り、を E2E で
- A1: 5 種のログインを mock プロバイダーで E2E (Prismtone の `e2e/mock-oauth.ts` などを移す)。Lodestone の確認は fixture で
- A2: 旧 Prismtone の利用者を作り、Lumorphia で同じプロバイダーにログイン → 引き継ぎ → 投稿・お気に入り・確認済みキャラクターがそのまま、を E2E で。別人の (provider, id) では引き継げないこと、2 つ目の Lumorphia アカウントからは同じ Prismtone 利用者を取れないこと
- 本番の切り替えの前に、本番 DB のバックアップから復元した環境で 3 人分の引き継ぎを試す
- 退会: 両方の種類で、30 日以内の復旧と、30 日後の物理削除が全サービスに及ぶことを E2E とジョブのテストで

## 6. 規約とプライバシーポリシー

Prismtone の本文を土台にして、2 層に分ける。

| 層                               | 持つもの                                                                                                                                                                                                          | Prismtone の章                            |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| Lumorphia 共通の規約             | 運営の方針 (個人・非営利・非公式)、利用できる方 (15 歳以上、外部アカウント、1 人 1 アカウント)、アカウントとキャラクターの禁止事項 (なりすまし、他人のキャラクターの確認)、2 種類の退会、免責、規約の変更、準拠法 | 1、2、4 の一部、8、9、10、11              |
| サービスの規約                   | 投稿できる画像、投稿の禁止事項、違法なコンテンツ、権利者からの依頼、通報と措置、そのサービスだけの退会                                                                                                            | 3、4 の残り、5、6、7、8                   |
| Lumorphia のプライバシーポリシー | ログインで受け取る情報、handle とプロフィール、キャラクターと Lodestone、サービスに渡す情報 (sub、handle、表示名、アイコン、キャラクター、引き継ぎ用のプロバイダーの組)、退会と削除                               | 1 のアカウントとキャラクター、5、6 の一部 |
| サービスのプライバシーポリシー   | 投稿、画像、外部への送信、Cookie、そのサービスの保存期間                                                                                                                                                          | 1 の投稿、2、3、4、5、6                   |

## 7. まだ決めていないこと

- Lumorphia アカウントの規約とプライバシーポリシーの本文 (下書きの方針は 6 章)
