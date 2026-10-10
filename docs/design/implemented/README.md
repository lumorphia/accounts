# Lumorphia 実装の確認画像

採用案をReact Routerの本番ビルドとwebsiteの実HTMLに反映した状態を、両ホストをHTTPSで配信して確認する。
`pnpm e2e e2e/brand.spec.ts` でPC・スマートフォン・ライト／ダークの画像を更新する。

- [ログイン PC](login-pc-dark.png) / [スマートフォン](login-sp-light.png)
- [初回登録 PC](welcome-pc-light.png) / [スマートフォン](welcome-sp-light.png)
- [アカウント管理 PC](settings-pc-light.png) / [スマートフォン](settings-sp-light.png)
- [ログイン後のトップ PC](home-pc-dark.png) / [スマートフォン](home-sp-dark.png)

長い表示名でレイアウトを確認している。ログイン画像では開発用フォームを隠す。OAuthモックの検証用にXが有効だが、本番では環境変数を未設定として表示しない。
