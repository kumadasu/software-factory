# 工程3:実装する

`analysis.json`、`interface.ts`、`SC-*.test.ts` を読み、`impl.ts` を書いてください。

- `import type { Event, Output } from "./interface"`、`export const initialState: () => State`、`export function step(state: State, event: Event): { state: State; output: Output }`。
- 純粋関数にする。時刻は `tick` イベントだけで進める。
- `npx vitest run` と `npx tsc --ignoreConfig --noEmit --strict impl.ts interface.ts` が通るまで直す。
- テストを変更・削除しない。
