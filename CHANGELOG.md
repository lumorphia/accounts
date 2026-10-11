# Changelog

## 1.0.0 (2026-10-11)


### Features

* A1.1a のソーシャルログインと認証基盤を追加 ([ba87728](https://github.com/lumorphia/accounts/commit/ba87728ec24d15de7ea38b5e29e73a45c8ebf444))
* A1.1b の MiAuth と Mastodon ログインを追加 ([a03091d](https://github.com/lumorphia/accounts/commit/a03091d8185d2b8dc6060e8d6d5f4de3ae5c1d61))
* A1.1c のプロフィールと初回設定を追加 ([b9c6368](https://github.com/lumorphia/accounts/commit/b9c6368951c7107b26397f2ecd59d07c07117c5c))
* A1.1d の設定画面と連携操作を追加 ([c1b4cd5](https://github.com/lumorphia/accounts/commit/c1b4cd59f165421b562ba6bcd59b75259d325f8a))
* A1.2a の OIDC 発行元とクライアント登録を追加 ([6dab0f6](https://github.com/lumorphia/accounts/commit/6dab0f65f524839137c413254924d73193c80e2c))
* A1.2b の OIDC ログインと初回設定から認可を再開する ([0a83acb](https://github.com/lumorphia/accounts/commit/0a83acb478274fb43985d59600e1b911d43bcd37))
* A1.2d の OIDC ログアウト連携と通知配送を整える ([fd2e01c](https://github.com/lumorphia/accounts/commit/fd2e01c4193e89f7e8bc70b7ccc9957940d81dac))
* A1.3a の Lodestone キャラクター取得を移す ([b3a369a](https://github.com/lumorphia/accounts/commit/b3a369aa34448ef7d79692238cc6e83380bb029c))
* A1.3b のキャラクター確認と再同期ジョブを追加する ([aa8715e](https://github.com/lumorphia/accounts/commit/aa8715e6f054c537d1f9f65748b9d6f85b6aad6c))
* A1.6 の規約同意と本番構成・監視を整備 ([e71ced1](https://github.com/lumorphia/accounts/commit/e71ced12b080ccc11bcbb076e1b43302315d76c5))
* **app:** Fastify と React Router の土台、死活確認、CSP を置く ([dade7c0](https://github.com/lumorphia/accounts/commit/dade7c0dc046569d736036d7ac64b41074cbce1c))
* **db:** DB の接続・マイグレーション・テストの専用 DB を置く ([e176781](https://github.com/lumorphia/accounts/commit/e1767818d618a399b84de067e8176ca1cd209e12))
* Lumorphia のブランド画面とトップへのログイン導線 (ADR-0014) ([e3c37d3](https://github.com/lumorphia/accounts/commit/e3c37d388a624c1756c3a45c7f1b818828f261fe))
* キャラクター設定とサービス向け一覧 API を接続する ([388a84a](https://github.com/lumorphia/accounts/commit/388a84a1b0a2731a34c02d3547037b100cfd67f5))
* サービス向けのキャラクター一覧に未認証も verified: false で含める ([9cb8b0e](https://github.com/lumorphia/accounts/commit/9cb8b0e0160a471de5387bfafc378d0201eb9622))
* 引き継ぎの完了で旧サービスのキャラクターを取り込む ([3820391](https://github.com/lumorphia/accounts/commit/3820391de290486cc15060da5e04ac77ea84f6b9))
* 旧アカウント台帳とhandle予約、引き継ぎ案内を追加 ([c983bd4](https://github.com/lumorphia/accounts/commit/c983bd4b0f2c249df6e6bf1db8169f5a30875793))
* 滞留とバックアップの遅れを Discord に知らせる notify.sh ([0c574f2](https://github.com/lumorphia/accounts/commit/0c574f2b9c59049fe2783534ca2830c9699f3b6b))
* 設定画面からサービスへ戻る先を確かめる API ([a654b08](https://github.com/lumorphia/accounts/commit/a654b0825cd995ea81a1ea0c845e42420c7ccd23))
* 設定画面にサービスへ戻るリンクを出す ([04427d9](https://github.com/lumorphia/accounts/commit/04427d9dcf97bdfa6acf357565ab5d80007c161e))
* 退会からの復旧をログインではなく本人の操作にする ([20b2008](https://github.com/lumorphia/accounts/commit/20b2008b713075a35cf415e46ec69ad6607d4b14))
* 退会と30日復旧、物理削除と通知の再送を追加 ([2950f6f](https://github.com/lumorphia/accounts/commit/2950f6f1a03996819d90ae4a155334eca060e2fa))
* 開発と E2E を https の *.lumorphia.test で動かす ([23b85e5](https://github.com/lumorphia/accounts/commit/23b85e5d0ab2e30393b1b1649f398d094184cfe6))
* 隔離した復元試験を compose.restore-test.yaml で回す ([e569c9f](https://github.com/lumorphia/accounts/commit/e569c9f761c6afaf4700600fa5f08cd1ed6901f2))


### Bug Fixes

* Better Auth の HTTP の口を使うものだけの許可リストにする ([a0aa24c](https://github.com/lumorphia/accounts/commit/a0aa24cc3e20c973be3e08961c79b58e274579a0))
* OIDC 外部キーの参照先を一意制約にする ([ca730af](https://github.com/lumorphia/accounts/commit/ca730afe73fb32dd11fa0aaff2e4a7d053278191))
* サービスを OAuth クライアントの表示名ではなく metadata で見分ける ([e6631a9](https://github.com/lumorphia/accounts/commit/e6631a9d39f3017bf953b990499df2b7491a7655))
* テスト用ホスト番号の型を確定 ([8ab08a2](https://github.com/lumorphia/accounts/commit/8ab08a2a5082ebd42eb92d00306de62aa21322c5))
* トップページのログイン表示をセッションに合わせる ([0b67016](https://github.com/lumorphia/accounts/commit/0b67016b4309eaf63a109f29a16dd463ad99e789))
* 同じメールの別のログイン方法を既存の利用者に連携しない ([077a70b](https://github.com/lumorphia/accounts/commit/077a70b350e7fea42515a4c5f261eddb2e5300a0))
* 引き継ぎのリンク先を Prismtone の /login にし、Caddy の載せ方を本番に合わせる ([c7485a0](https://github.com/lumorphia/accounts/commit/c7485a02b49bf294fe61b77480c1e4214f3620b6))
* 復元試験の件数に利用者の総数を出す ([7afbcf9](https://github.com/lumorphia/accounts/commit/7afbcf97a9dd4adf4254fe09179092b4cb222ceb))
* 復元試験は up --abort-on-container-exit ではなく run --rm counts で回す ([af40cac](https://github.com/lumorphia/accounts/commit/af40cacc85d21e388ac91e328ca613e5560dbf60))
* 連携先のアイコンの転送を 3 回までたどり、Misskey のアイコンを使えるようにする ([4d8d470](https://github.com/lumorphia/accounts/commit/4d8d47077284ca281dbc0cca22f7786553ec622c))
* 開発のアイコンをサービスの画面から読めるようにする ([816e0c6](https://github.com/lumorphia/accounts/commit/816e0c6dce1669dab018b4879b9907a11cf62459))


### Refactoring

* サーバー間 API の Bearer 検証をまとめ、状態の変更を認可の入口に移す ([cd5e878](https://github.com/lumorphia/accounts/commit/cd5e8788e5f21c1e3c879772ae19c1a03a517649))


### Build

* monorepo の骨組みを作る ([c62bd05](https://github.com/lumorphia/accounts/commit/c62bd052ca95df82dfd46be31bbc4dc9b8ee9465))
* 初回バックアップを migration 完了後に開始 ([7468602](https://github.com/lumorphia/accounts/commit/7468602dea9d9fa78ceba358d437bdd678ee31af))
* 本番は latest を使い、accounts 専用の doco-cd で入れ替える ([f5be89d](https://github.com/lumorphia/accounts/commit/f5be89d9b1f4084e99086e77a1bac801e19d184d))
