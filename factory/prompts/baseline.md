# 実装する(題材メモだけから)

`brief.md` の題材について、`interface.ts` の入出力に合わせて `impl.ts` を書いてください。人に質問せず、題材メモの範囲で決めてください。

- `import type { Event, Output } from "./interface"`、`export const initialState: () => State`、`export function step(state: State, event: Event): { state: State; output: Output }`。
- 純粋関数にする。時刻は `tick` イベントだけで進める。
- テストからは `./harness` の `run(events: Event[]): Output[]` で呼ばれます(`harness.ts` は用意済み)。
- 確かめたいことがあれば、自分でテスト(`*.test.ts`)を書いて `npx vitest run` で動かしてよい。
- `npx tsc --ignoreConfig --noEmit --strict impl.ts interface.ts` が通るまで直す。
