# software-factory

題材メモ1枚から、STPA(System-Theoretic Process Analysis)による安全分析、安全制約ごとのテスト、実装までを、人の介入なしで回すソフトウェアファクトリーの実験用リポジトリです。各工程は Claude Code(`claude -p`)が担当し、工程の合否は決定的なゲート(プログラム)が決めます。

発表スライド:[docs/stpa-factory-slides.pdf](docs/stpa-factory-slides.pdf)

## 流れ

```
題材メモ ─▶ 工程0 入出力の型と隠しテスト ─▶ 工程1 STPA分析 ─▶ 工程2 SCごとのテストと壊した実装 ─▶ 工程3 実装 ─▶ 隠しテスト
                                              ▲                                                            │
                                              └──────────── 落ちたテスト名を「満たされなかった期待」として差し戻す ──┘
```

| 工程 | 作るもの | ゲート |
|---|---|---|
| 0 | `interface.ts`、隠しテスト(題材メモだけから勘で書く。以降の工程からは隔離) | 型チェック、テストの本数 |
| 1 | `analysis.json`(ロス、ハザード、制御アクション、UCA、安全制約SC) | 制御アクション×4分類の網羅、全UCAがSCで覆われる、参照が実在する |
| 2 | SCごとのテスト `SC-n.test.ts` と、そのSCだけを破った実装 `mutant.SC-n.ts` | 各テストが対応するmutantで落ちる |
| 3 | `impl.ts`(分析とSCのテストだけを見て書く。題材メモは渡さない) | 型チェック、SCのテストが全部通る |
| 最終 | — | 隠しテストが通る。落ちたら工程1へ差し戻す(最大2回) |

比較のため、題材メモと `interface.ts` だけから実装させる「STPAなし」の実験(baseline)も用意しています。

改善版(未検証):ブランチ `feat/no-mutants` は、mutantと工程3をやめて工程2でテストと実装を一緒に作り、制御アクションの上限を6個、SCの上限を16本に上げた版です。テストは通りますが、題材を最後まで流した実績はまだありません。

## 使い方

前提:Node.js 22 以上と、ログイン済みの Claude Code CLI(`claude`)。

```sh
npm install
npm test                                              # ファクトリー自体のテスト

npm run factory -- subjects/cube-elevator/brief.md    # ファクトリーを1回回す(結果は runs/ に出る)
npm run factory -- <brief.md> --run runs/<name>       # 実行先を指定、または同じ実行先で再開
npm run factory -- <brief.md> --review-holdout        # 隠しテストを作ったところで止め、人が見てから再開

npm run baseline -- <brief.md> runs/<name>            # STPAなしで実装し、その実行の隠しテストとSCのテストを当てる
```

## 題材

- `subjects/elevator`:1台のエレベーター(火災時の運転を含む)
- `subjects/navi`:車載機の画面と音声の調停(スマホ連携)
- `subjects/navi-async`:同じ題材で、スマホが判断し、車載機は緊急時だけ強制する版
- `subjects/cube-elevator`:3×3×3の立方体の中を2台のかごが縦横に動くエレベーター(故障の復旧、火災を含む)

## わかったこと

- よく知られた型にはまる題材(エレベーター、ナビ)では、STPAなしの実装もテストをほぼ全部通り、差は題材メモの決め漏れの選び方だけだった。
- 立方体エレベーターでは、「人を乗せた後に、行き先のマスを故障したかごがふさぐ」と、STPAなしの実装は扉を閉めたまま待ち続け、救出も呼ばなかった。STPAありは、この状況をUCAとして拾い、安全制約で防いでいた。
- この欠陥を捕まえたのは、SCのテストと、2つの実装をランダムな入力列で突き合わせる比較だった。勘で書いた隠しテストは見逃した。

詳しい経過は [docs/practice-log.md](docs/practice-log.md) にあります。

## ライセンス

[MIT No Attribution(MIT-0)](LICENSE)。著作権表示も不要で、自由に使えます。
