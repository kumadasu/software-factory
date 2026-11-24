# 工程0:I/Fと隠しテストを作る

`brief.md` の題材について、次の2つを作業ディレクトリに書いてください。人に質問せず、題材メモの範囲で決めてください。

## 1. `interface.ts`

制御ソフトの入出力の型を定義します。状態の持ち方は書きません。

- `export type Event`:入力イベントのユニオン型。`type` は `"<送り手>.<名前>"`(例:`"door.obstructed"`)。時間経過は `{ type: "tick"; ms: number }`。
- `export type Output`:1ステップごとの出力のスナップショット。
- `export const IO = { inputs: [...], outputs: [...] } as const`:`inputs` はすべての `Event` の `type`。`outputs` は `Output` のキー(入れ子ならドット区切り、例:`"car.floor"`)。

実装は `initialState()` と `step(state, event) => { state, output }` を持ちます。テストからは `./harness` の `run(events: Event[]): Output[]` で呼びます(`harness.ts` はあとで用意されるので、作らないでください)。

## 2. `holdout/*.test.ts`(3〜8ファイル)

実装を知らない第三者として、題材の要求を満たすか確かめるブラックボックステストを書きます。

- import は `vitest`、`./harness`、`./interface` だけ(`holdout/` の中に置きますが、実行時は `interface.ts` と同じ階層に並べられます)。
- 1ファイル=1つの観点。観点は「通常の利用」「境界値」「割り込みと、その後の復帰」「同時に起きる入力」から幅広く選ぶ。
- テストのタイトル(`it` の第1引数)は、満たすべき期待される振る舞いを日本語の1文で書く(不具合の症状ではなく、正しい振る舞いの側を書く)。テストの番号や実装の用語を入れない。例:「扉が閉まりきるまで、かごは動かない」。
- 内部状態は見ない。`run()` の出力だけで判定する。
- 1本は `holdout/final.test.ts` という名前にする。最も重要な要求を、ほかのファイルと重ならない形で確かめる。

型チェックが通ることを `npx tsc --ignoreConfig --noEmit --strict interface.ts` で確かめてください。
