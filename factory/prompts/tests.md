# 工程2:安全制約ごとにテストと壊した実装を作る

`analysis.json` の `constraints` の各 SC-n について、作業ディレクトリに次の2つを書いてください。

1. `SC-n.test.ts`:SC-nが守られていることを確かめるテスト。
   - import は `vitest`、`fast-check`、`./harness`、`./interface` だけ。
   - 状況の組み合わせが多いものは、fast-checkで入力イベント列を生成して確かめる(`fc.assert(fc.property(...))`)。
2. `mutant.SC-n.ts`:SC-nだけを破り、ほかはもっともらしく動く実装。
   - 先に、すべてのSCを守る参照実装を `reference.ts` に1つ書く。各mutantは `reference.ts` をコピーし、SC-nを破るために**1か所だけ**変えたものにする(実装を書き直さない)。
   - `import type { Event, Output } from "./interface"`、`export const initialState`、`export function step(state, event): { state, output }`。

`mutant.SC-n.ts` を `impl.ts` にコピーして `npx vitest run SC-n.test.ts` を実行し、テストが**落ちる**ことを確かめてください。あわせて `reference.ts` を `impl.ts` にコピーして `npx vitest run` を実行し、すべてのSCのテストが**通る**ことを確かめてください(テストが厳しすぎたり、SC同士が矛盾したりしていないかの確認)。確かめた後、`impl.ts` は消してください。
