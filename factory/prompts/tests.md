# 工程2:安全制約ごとのテストと実装を作る

`analysis.json` の `constraints` の各 SC-n について `SC-n.test.ts` を書き、すべてのSCを守る実装を `impl.ts` に書いてください。人に質問せず、`analysis.json` の範囲で決めてください。

1. `SC-n.test.ts`:SC-nが守られていることを確かめるテスト。
   - import は `vitest`、`fast-check`、`./harness`、`./interface` だけ。
   - 状況の組み合わせが多いものは、fast-checkで入力イベント列を生成して確かめる(`fc.assert(fc.property(...))`)。
   - 「〜しない」型のSCは、何もしない実装でも通ってしまわないよう、SCが破られうる危ない状況に実際に届く入力列を生成する。
2. `impl.ts`:すべてのSCを守る実装。
   - `import type { Event, Output } from "./interface"`、`export const initialState: () => State`、`export function step(state: State, event: Event): { state: State; output: Output }`。
   - 純粋関数にする。時刻は `tick` イベントだけで進める。

`npx vitest run` と `npx tsc --ignoreConfig --noEmit --strict impl.ts interface.ts` が通るまで直してください。テストが通らないときは、テストを緩めるのではなく、SCどおりに実装を直してください。
