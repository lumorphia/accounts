# ADR の一覧

| 番号                                          | 決めたこと                                                         |
| --------------------------------------------- | ------------------------------------------------------------------ |
| [0001](0001-record-architecture-decisions.md) | ADR を使う                                                         |
| [0002](0002-stack-hosting-and-visibility.md)  | prismtone と同じ構成・同じ VPS、リポジトリは public                |
| [0003](0003-oidc-provider-better-auth.md)     | 発行元は Better Auth の oauth-provider、サービスは generic-oauth   |
| [0004](0004-logout-confirmation-form-csp.md)  | OIDC のログアウト確認ページで登録済みの戻り先を form-action に足す |
| [0005](0005-lodestone-character-source.md)    | Lodestone のキャラクター取得を accounts に置く                     |
| [0006](0006-character-ownership-and-jobs.md)  | キャラクターの所有と再同期の要求を DB で確定する                   |

| [0007](0007-character-api-and-shared-pacing.md) | キャラクター API の権限と Lodestone の取得順を共有する |

| [0008](0008-account-lifecycle-outbox.md) | 退会・復旧・物理削除を永続的な送信待ちの表で配送する |

| [0009](0009-legacy-ledger-and-handle-reservations.md) | 旧台帳の取り込み・handle の本人用予約・移行完了を原子的に扱う |

本文中の「prismtone ADR-NNNN」は lumorphia/prismtone の ADR を指す。全体の計画は [plan.md](../plan.md)。
