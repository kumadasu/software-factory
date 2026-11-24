# 安全分析ファクトリー 設計

題材メモ1枚から、安全分析 → テスト → 実装までを人の介入なしで回すソフトウェアファクトリー。ハッカソンのルール「まずは1件を自動で回す」(実行中に人が合否を決めない)に合わせる。

- 練習の題材:エレベーター制御
- 当日の題材:ナビ×スマホ連携の縮小版(画面と音声の権利の調停、割り込みと復帰)
- 言語:TypeScript(Vitest、fast-check)。AIの呼び出しは `claude -p`

## 全体の流れ

```
brief.md ─▶ [0 I/Fと隠しテスト] ─(任意:人の確認)─▶ 凍結
                                                     │
brief.md ─▶ [1 分析] ─G1─▶ [2 テスト作成] ─G2─▶ [3 実装] ─G3─▶ 合格
               ▲                                        │
               └──────── 隠しテスト不合格(症状のみ) ─────┘
```

| 工程 | 入力 | 出力 | ゲート(トークンなし) |
|---|---|---|---|
| 0 I/Fと隠しテスト | brief.md | `interface.ts`、`holdout/*.test.ts` | G0:型チェックが通る。隠しテストが3〜8本 |
| 1 分析 | brief.md、STPA手順書、interface.ts | `analysis.json` | G1(後述) |
| 2 テスト作成 | analysis.json、interface.ts | `tests/SC-n.test.ts`、`mutants/SC-n.ts` | G2:どのSCにもテストがある。SC-nのテストがSC-nのmutantで落ちる |
| 3 実装 | analysis.json、interface.ts、tests/ | `app/index.ts` | G3:型、AIのテスト、隠しテストがすべて通る |

- 工程0はSTPA手順書を読まない。利用シナリオ、境界値、割り込みと復帰の観点で隠しテストを書く(分析役と切り口を変える)。
- 工程0は本番の実行と分けて走らせられる。`--review-holdout` を付けると工程0の後で停止し、人が確認してから工程1以降を始める(実行前の準備に当たる)。既定は全自動。

## 差し戻し

- G1〜G3の決定的な失敗:その工程を、具体的な理由を付けて再実行する。工程ごとに最大3回。
- G3の隠しテスト失敗:工程1まで戻す。渡すのは症状だけ(落ちたテスト名は見せず、テストのdescribeに書いた観察可能な症状の文を渡す)。この差し戻しは最大2回。
- `holdout/` の中で `final: true` の1本は、結果を一度も返さない最終チェック専用。
- 上限に達したら停止し、それまでのログを残す。

## 隔離

- 各工程は専用の作業ディレクトリで動く。進行役がその工程の入力だけをコピーしてから `claude -p` を呼ぶ。
- 隠しテストは作業ディレクトリの外(`runs/<id>/private/`)に置き、`--settings` の権限設定でReadを拒否する。
- 各工程の `claude -p` は `--max-turns` で上限を設ける。

## analysis.json のスキーマ

STPAのみ使う(HAZOPは使わない)。

```jsonc
{
  "controllers": [
    { "id": "carController", "implemented": true },
    { "id": "passenger", "implemented": false }   // 制御アクションはI/Fの入力イベントとして届く
  ],
  "losses":   [{ "id": "L-1", "text": "..." }],
  "hazards":  [{ "id": "H-1", "text": "...", "losses": ["L-1"] }],
  "controlActions": [{ "id": "CA-1", "controller": "carController", "name": "move" }],
  "ucas": [{ "id": "UCA-1", "action": "CA-1",
             "type": "notProvided | providedUnsafe | wrongTiming | wrongDuration",
             "context": "...", "hazards": ["H-1"] }],
  "notApplicable": [{ "action": "CA-1", "type": "wrongDuration", "reason": "..." }],
  "constraints": [{ "id": "SC-1", "text": "...", "ucas": ["UCA-1"],
                    "refs": ["input.door.obstructed", "output.car.motion"] }]
}
```

G1で検査すること:

1. IDが一意で、参照先がすべて存在する
2. 各制御アクション×4分類が、UCAか `notApplicable`(理由つき)で埋まっている
3. UCA → ハザード → ロスが途切れていない
4. すべてのUCAが1つ以上のSCで覆われている
5. SCの `refs` がinterface.tsに実在する。すべてのSCが、実装するコントローラの出力を1つ以上含む
6. 実装しないコントローラの制御アクションが、I/Fの入力イベントに対応している
7. 規模:制御アクション2〜4個、SC 3〜8本

## I/F の形

`step(state, event) => { state, output }` の純粋関数。時刻はイベントの仮想時刻で進める。工程0がbrief.mdから具体的な型を作り、凍結する。

## 記録

`runs/<id>/` に次を残す。

- 工程ごとの入力、出力、`claude -p` のログ
- `report.json`:工程ごとの試行回数、ゲートの結果、差し戻しの履歴
- 隠しテストがAIのmutantを落とした割合(隠しテストの強さの目安)

## ディレクトリ構成

```
factory/
  run.ts                 進行役
  prompts/               工程0〜3のプロンプト
  stpa-guide.md          STPA手順書(工程1だけが読む)
  gates/                 G0〜G3
  schema/analysis.schema.json
subjects/
  elevator/brief.md      練習用
  navi/brief.md          当日用(当日に書く)
runs/<id>/               実行ごとの成果物とログ(git管理外)
```

## 練習の題材:エレベーター(brief.md の中身)

- 4フロア、かご1台
- 入力:乗り場の呼び出し、かご内の呼び出し、扉のセンサ(障害物あり・なし)、火災報知(発報・復旧)、時間経過
- 出力:かごの階と動き、扉の状態、運転モード
- 上位要求:扉が開いている間はかごを動かさない。人が挟まれそうなら扉を閉めない。火災時はすべての呼び出しより避難を優先する。呼ばれた階にはいずれ必ず行く

## 練習で比べること

1. 全自動(工程0の隠しテストをそのまま使う)
2. 工程0の後に人が確認した隠しテストを使う

2つで隠しテストの失敗内容と、AIのmutantを落とした割合を比べ、人の確認が拾った見落としを記録する。あわせて、題材メモから合格までの時間を測り、当日の時間配分に使う。

## 範囲外

- HAZOP、通信路の擬似実装、builder 2本、反省ループ、PR作成と人の承認
- UI
