# 工程2:安全制約ごとにテストと壊した実装を作る

`analysis.json` の `constraints` の各 SC-n について、作業ディレクトリに次の2つを書いてください。

1. `SC-n.test.ts`:SC-nが守られていることを確かめるテスト。
   - import は `vitest`、`fast-check`、`./harness`、`./interface` だけ。
   - 状況の組み合わせが多いものは、fast-checkで入力イベント列を生成して確かめる(`fc.assert(fc.property(...))`)。
2. `mutant.SC-n.ts`:SC-nだけを破り、ほかはもっともらしく動く実装。
   - `import type { Event, Output } from "./interface"`、`export const initialState`、`export function step(state, event): { state, output }`。

`mutant.SC-n.ts` を `impl.ts` にコピーして `npx vitest run SC-n.test.ts` を実行し、テストが**落ちる**ことを確かめてください。確かめた後、`impl.ts` は消してください。
