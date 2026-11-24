# 安全分析ファクトリー Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 題材メモ1枚から、I/Fと隠しテスト → STPA分析 → テストとmutant → 実装を `claude -p` で自動で回し、決定的ゲートで検査する進行役を作る。

**Architecture:** 進行役 `factory/run.ts` が工程0〜3を順に呼ぶ。各工程は専用の作業ディレクトリで動く `claude -p`(テストでは偽のAgentに差し替える)。ゲートG0〜G3はトークンを使わず、tsc、Vitest、`analysis.json` の構造検査で判定する。ワークスペースは平置き(`interface.ts`、`harness.ts`、`impl.ts`、`*.test.ts` を同じ階層)にし、mutantや実装は `impl.ts` として差し替えて実行する。

**Tech Stack:** Node 22、TypeScript、tsx、Vitest、fast-check、Claude Code CLI(`claude -p`)

**Spec:** `docs/superpowers/specs/2026-11-23-safety-analysis-factory-design.md`

## Global Constraints

- コードのコメント、docstring、ログメッセージは英語で書く。
- 工程ごとの再試行は最大3回。隠しテストによる工程1への差し戻しは最大2回。
- 隠しテストの `final.test.ts` の結果は、AIに一度も返さない。
- 隠しテストからAIに返すのは、テストのタイトル(観察可能な症状の文)だけ。ファイル名やコードは返さない。
- `runs/` はgit管理外。
- 仕様からの変更点:`schema/analysis.schema.json` は作らず、`factory/gates/analysis.ts` の型とG1の検査で代える。制御アクションに `event` フィールドを足す(実装しないコントローラのアクションが、どの入力イベントに対応するか)。

## ワークスペースの約束(全タスク共通)

| ファイル | 書く人 | 内容 |
|---|---|---|
| `interface.ts` | 工程0 | `export type Event`、`export type Output`、`export const IO = { inputs: [...], outputs: [...] } as const` |
| `harness.ts` | 固定(`factory/runtime/harness.ts`) | `run(events)` で `impl.ts` を順に適用し、出力の配列を返す |
| `impl.ts` | 工程3(またはmutantを差し替え) | `export const initialState: () => State`、`export function step(s, e): { state, output }` |
| `SC-n.test.ts` | 工程2 | `./harness` と `./interface` だけをimport |
| `mutant.SC-n.ts` | 工程2 | `impl.ts` と同じ形で、SC-nだけを破った実装 |
| `holdout/*.test.ts` | 工程0 | 同上。`final.test.ts` は最終チェック専用 |

---

### Task 1: 足場、ワークスペース組み立て、Vitest実行

**Files:**
- Create: `package.json`、`tsconfig.json`、`vitest.config.ts`、`.gitignore`
- Create: `factory/runtime/harness.ts`
- Create: `factory/lib/workspace.ts`
- Create: `factory/lib/vitest.ts`
- Create: `factory/__fixtures__/lamp/`(下記の各ファイル)
- Test: `factory/lib/vitest.test.ts`

**Interfaces:**
- Produces:
  - `assemble(dir: string, files: Record<string, string>): void`:`dir` を作り直し、キー(ワークスペース内のパス)に値(コピー元の絶対パス)をコピーする。
  - `runVitest(dir: string): Promise<VitestResult>`
  - `type VitestResult = { ok: boolean; crashed: boolean; failures: { file: string; title: string; message: string }[] }`
  - `HARNESS_PATH: string`(`factory/runtime/harness.ts` の絶対パス)
  - `FIXTURE_DIR: string`(`factory/__fixtures__/lamp` の絶対パス)

- [ ] **Step 1: ブランチを切り、足場を作る**

```bash
git switch -c feat/safety-factory
npm init -y
npm i -D typescript tsx vitest fast-check @types/node
```

`package.json` の `scripts` と `type` を次にする。

```json
{
  "type": "module",
  "scripts": {
    "test": "vitest run",
    "factory": "tsx factory/run.ts"
  }
}
```

`tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "types": ["node"]
  },
  "include": ["factory/**/*.ts"],
  "exclude": ["factory/__fixtures__/**", "factory/runtime/**"]
}
```

`vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["factory/**/*.test.ts"],
    exclude: ["factory/__fixtures__/**", "runs/**", "node_modules/**"],
    testTimeout: 120_000,
  },
});
```

`.gitignore`:

```
node_modules/
runs/
```

- [ ] **Step 2: 固定のharnessを書く**

`factory/runtime/harness.ts`:

```ts
// Fixed helper copied into every workspace. Applies impl.step to a sequence of events.
import type { Event, Output } from "./interface";
import { initialState, step } from "./impl";

export function run(events: Event[]): Output[] {
  let state = initialState();
  const outputs: Output[] = [];
  for (const event of events) {
    const result = step(state, event);
    state = result.state;
    outputs.push(result.output);
  }
  return outputs;
}
```

- [ ] **Step 3: 小さな題材(ランプ)のフィクスチャを書く**

ゲートと進行役のテストで使う。`factory/__fixtures__/lamp/` に置く。

`interface.ts`:

```ts
export type Event =
  | { type: "user.on" }
  | { type: "user.off" }
  | { type: "sensor.overheat"; active: boolean };

export type Output = { lamp: "on" | "off" };

export const IO = {
  inputs: ["user.on", "user.off", "sensor.overheat"],
  outputs: ["lamp"],
} as const;
```

`impl.ts`(正しい実装):

```ts
import type { Event, Output } from "./interface";

type State = { want: boolean; hot: boolean };

export const initialState = (): State => ({ want: false, hot: false });

export function step(s: State, e: Event): { state: State; output: Output } {
  const n = { ...s };
  if (e.type === "user.on") n.want = true;
  if (e.type === "user.off") n.want = false;
  if (e.type === "sensor.overheat") n.hot = e.active;
  return { state: n, output: { lamp: n.want && !n.hot ? "on" : "off" } };
}
```

`mutant.SC-1.ts`(過熱を無視する):

```ts
import type { Event, Output } from "./interface";

type State = { want: boolean };

export const initialState = (): State => ({ want: false });

export function step(s: State, e: Event): { state: State; output: Output } {
  const n = { ...s };
  if (e.type === "user.on") n.want = true;
  if (e.type === "user.off") n.want = false;
  return { state: n, output: { lamp: n.want ? "on" : "off" } };
}
```

`SC-1.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { run } from "./harness";

describe("SC-1", () => {
  it("does not light while overheated", () => {
    const outs = run([{ type: "sensor.overheat", active: true }, { type: "user.on" }]);
    expect(outs.at(-1)).toEqual({ lamp: "off" });
  });
});
```

`holdout/h1.test.ts`:

```ts
import { it, expect } from "vitest";
import { run } from "./harness";

it("過熱が解消すると、点灯の要求が残っていればランプが点く", () => {
  const outs = run([
    { type: "user.on" },
    { type: "sensor.overheat", active: true },
    { type: "sensor.overheat", active: false },
  ]);
  expect(outs.map((o) => o.lamp)).toEqual(["on", "off", "on"]);
});
```

`holdout/h2.test.ts`:

```ts
import { it, expect } from "vitest";
import { run } from "./harness";

it("点灯を要求していなければ、ランプは消えたまま", () => {
  const outs = run([{ type: "sensor.overheat", active: false }]);
  expect(outs.at(-1)).toEqual({ lamp: "off" });
});
```

`holdout/final.test.ts`:

```ts
import { it, expect } from "vitest";
import { run } from "./harness";

it("消灯を要求するとランプが消える", () => {
  const outs = run([{ type: "user.on" }, { type: "user.off" }]);
  expect(outs.at(-1)).toEqual({ lamp: "off" });
});
```

`analysis.json`:

```json
{
  "controllers": [
    { "id": "lampController", "implemented": true },
    { "id": "user", "implemented": false }
  ],
  "losses": [{ "id": "L-1", "text": "Fire caused by the lamp" }],
  "hazards": [{ "id": "H-1", "text": "Lamp is lit while overheated", "losses": ["L-1"] }],
  "controlActions": [
    { "id": "CA-1", "controller": "lampController", "name": "light" },
    { "id": "CA-2", "controller": "user", "name": "requestOn", "event": "user.on" }
  ],
  "ucas": [
    { "id": "UCA-1", "action": "CA-1", "type": "providedUnsafe", "context": "while overheated", "hazards": ["H-1"] },
    { "id": "UCA-2", "action": "CA-1", "type": "wrongDuration", "context": "keeps lighting after overheat starts", "hazards": ["H-1"] },
    { "id": "UCA-3", "action": "CA-2", "type": "providedUnsafe", "context": "user requests on while overheated", "hazards": ["H-1"] }
  ],
  "notApplicable": [
    { "action": "CA-1", "type": "notProvided", "reason": "Not lighting is never hazardous" },
    { "action": "CA-1", "type": "wrongTiming", "reason": "No ordering with other actions" },
    { "action": "CA-2", "type": "notProvided", "reason": "No request means lamp stays off" },
    { "action": "CA-2", "type": "wrongTiming", "reason": "Covered by UCA-3" },
    { "action": "CA-2", "type": "wrongDuration", "reason": "Request is instantaneous" }
  ],
  "constraints": [
    { "id": "SC-1", "text": "The lamp must be off while overheated", "ucas": ["UCA-1", "UCA-2", "UCA-3"], "refs": ["input.sensor.overheat", "output.lamp"] }
  ]
}
```

- [ ] **Step 4: 失敗するテストを書く**

`factory/lib/vitest.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { assemble, HARNESS_PATH, FIXTURE_DIR } from "./workspace";
import { runVitest } from "./vitest";

const tmp = (name: string) => join(process.cwd(), "runs", "_test", name);
const fx = (f: string) => join(FIXTURE_DIR, f);

describe("runVitest", () => {
  it("passes when the correct impl meets the SC test", async () => {
    const dir = tmp("vitest-pass");
    assemble(dir, {
      "interface.ts": fx("interface.ts"),
      "harness.ts": HARNESS_PATH,
      "impl.ts": fx("impl.ts"),
      "SC-1.test.ts": fx("SC-1.test.ts"),
    });
    const r = await runVitest(dir);
    expect(r).toMatchObject({ ok: true, crashed: false, failures: [] });
  });

  it("reports failure titles when a mutant is tested", async () => {
    const dir = tmp("vitest-fail");
    assemble(dir, {
      "interface.ts": fx("interface.ts"),
      "harness.ts": HARNESS_PATH,
      "impl.ts": fx("mutant.SC-1.ts"),
      "SC-1.test.ts": fx("SC-1.test.ts"),
    });
    const r = await runVitest(dir);
    expect(r.ok).toBe(false);
    expect(r.crashed).toBe(false);
    expect(r.failures[0].title).toBe("does not light while overheated");
  });

  it("marks a suite that cannot load as crashed", async () => {
    const dir = tmp("vitest-crash");
    assemble(dir, { "harness.ts": HARNESS_PATH, "SC-1.test.ts": fx("SC-1.test.ts") });
    const r = await runVitest(dir);
    expect(r.ok).toBe(false);
    expect(r.crashed).toBe(true);
  });
});
```

- [ ] **Step 5: 失敗を確認する**

Run: `npx vitest run factory/lib/vitest.test.ts`
Expected: FAIL(`./workspace` が見つからない)

- [ ] **Step 6: 実装する**

`factory/lib/workspace.ts`:

```ts
import { cpSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
export const HARNESS_PATH = resolve(here, "../runtime/harness.ts");
export const FIXTURE_DIR = resolve(here, "../__fixtures__/lamp");

/** Recreate `dir` and copy each source file to its workspace-relative path. */
export function assemble(dir: string, files: Record<string, string>): void {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  for (const [rel, src] of Object.entries(files)) {
    const dest = join(dir, rel);
    mkdirSync(dirname(dest), { recursive: true });
    cpSync(src, dest);
  }
}
```

`factory/lib/vitest.ts`:

```ts
import { spawn } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join, relative } from "node:path";

export type VitestFailure = { file: string; title: string; message: string };
export type VitestResult = { ok: boolean; crashed: boolean; failures: VitestFailure[] };

type JsonReport = {
  numFailedTests: number;
  numFailedTestSuites: number;
  testResults: {
    name: string;
    status: string;
    message?: string;
    assertionResults: { title: string; status: string; failureMessages: string[] }[];
  }[];
};

/** Run every *.test.ts under `dir` (dir must live inside the repo so node_modules resolve). */
export function runVitest(dir: string): Promise<VitestResult> {
  const out = join(dir, ".vitest-result.json");
  rmSync(out, { force: true });
  return new Promise((resolvePromise) => {
    const child = spawn(
      "npx",
      ["vitest", "run", "--root", dir, "--reporter=json", `--outputFile=${out}`],
      { stdio: "ignore" },
    );
    child.on("close", () => {
      if (!existsSync(out)) {
        resolvePromise({ ok: false, crashed: true, failures: [] });
        return;
      }
      const report = JSON.parse(readFileSync(out, "utf8")) as JsonReport;
      const failures: VitestFailure[] = [];
      let crashed = false;
      for (const file of report.testResults) {
        const rel = relative(dir, file.name);
        if (file.assertionResults.length === 0 && file.status === "failed") crashed = true;
        for (const a of file.assertionResults) {
          if (a.status === "failed") {
            failures.push({ file: rel, title: a.title, message: a.failureMessages.join("\n") });
          }
        }
      }
      if (report.testResults.length === 0) crashed = true;
      resolvePromise({ ok: !crashed && failures.length === 0, crashed, failures });
    });
  });
}
```

- [ ] **Step 7: 通ることを確認する**

Run: `npx vitest run factory/lib/vitest.test.ts`
Expected: PASS(3件)

- [ ] **Step 8: コミット**

```bash
git add package.json package-lock.json tsconfig.json vitest.config.ts .gitignore factory/
git commit -m "feat: scaffold factory with workspace assembly and vitest runner"
```

---

### Task 2: G1(analysis.json の構造検査)

**Files:**
- Create: `factory/gates/analysis.ts`
- Create: `factory/gates/g1.ts`
- Test: `factory/gates/g1.test.ts`

**Interfaces:**
- Consumes: `FIXTURE_DIR`(Task 1)
- Produces:
  - `type Analysis`、`UCA_TYPES`
  - `readIO(interfaceSrc: string): { inputs: string[]; outputs: string[] }`:`IO` の配列リテラルを正規表現で読む
  - `checkAnalysis(analysis: unknown, io: { inputs: string[]; outputs: string[] }): string[]`(空なら合格)

- [ ] **Step 1: 失敗するテストを書く**

`factory/gates/g1.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { FIXTURE_DIR } from "../lib/workspace";
import { checkAnalysis, readIO } from "./g1";

const io = readIO(readFileSync(join(FIXTURE_DIR, "interface.ts"), "utf8"));
const base = () => JSON.parse(readFileSync(join(FIXTURE_DIR, "analysis.json"), "utf8"));

describe("readIO", () => {
  it("reads IO names from interface source", () => {
    expect(io).toEqual({ inputs: ["user.on", "user.off", "sensor.overheat"], outputs: ["lamp"] });
  });
});

describe("checkAnalysis", () => {
  it("accepts the fixture", () => {
    expect(checkAnalysis(base(), io)).toEqual([]);
  });

  it("flags an uncovered action x type cell", () => {
    const a = base();
    a.notApplicable = a.notApplicable.filter((n: any) => !(n.action === "CA-1" && n.type === "wrongTiming"));
    expect(checkAnalysis(a, io)).toContain("CA-1 x wrongTiming has neither a UCA nor a notApplicable entry");
  });

  it("flags a UCA not covered by any SC", () => {
    const a = base();
    a.constraints[0].ucas = ["UCA-1", "UCA-2"];
    expect(checkAnalysis(a, io)).toContain("UCA-3 is not covered by any constraint");
  });

  it("flags refs missing from the interface", () => {
    const a = base();
    a.constraints[0].refs = ["input.sensor.smoke", "output.lamp"];
    expect(checkAnalysis(a, io)).toContain("SC-1 refs unknown name input.sensor.smoke");
  });

  it("requires each SC to reference an output", () => {
    const a = base();
    a.constraints[0].refs = ["input.sensor.overheat"];
    expect(checkAnalysis(a, io)).toContain("SC-1 must reference at least one output");
  });

  it("requires external actions to map to input events", () => {
    const a = base();
    delete a.controlActions[1].event;
    expect(checkAnalysis(a, io)).toContain("CA-2 belongs to an external controller but has no valid input event");
  });

  it("flags dangling references and empty reasons", () => {
    const a = base();
    a.ucas[0].hazards = ["H-9"];
    a.notApplicable[0].reason = "";
    const errs = checkAnalysis(a, io);
    expect(errs).toContain("UCA-1 refers to unknown hazard H-9");
    expect(errs).toContain("notApplicable CA-1 x notProvided needs a reason");
  });

  it("enforces size limits", () => {
    const a = base();
    a.constraints = [];
    expect(checkAnalysis(a, io)).toContain("constraints must number 1..8 (got 0)");
  });

  it("rejects non-object input", () => {
    expect(checkAnalysis("nope", io)).toEqual(["analysis must be a JSON object with array fields"]);
  });
});
```

注:フィクスチャのSCは1本なので、SCの下限は仕様の3ではなく1にして、規模の上限だけ機械的に強制する(下限はプロンプトで指示する)。

- [ ] **Step 2: 失敗を確認する**

Run: `npx vitest run factory/gates/g1.test.ts`
Expected: FAIL(`./g1` が見つからない)

- [ ] **Step 3: 実装する**

`factory/gates/analysis.ts`:

```ts
export const UCA_TYPES = ["notProvided", "providedUnsafe", "wrongTiming", "wrongDuration"] as const;
export type UcaType = (typeof UCA_TYPES)[number];

export type Analysis = {
  controllers: { id: string; implemented: boolean }[];
  losses: { id: string; text: string }[];
  hazards: { id: string; text: string; losses: string[] }[];
  controlActions: { id: string; controller: string; name: string; event?: string }[];
  ucas: { id: string; action: string; type: UcaType; context: string; hazards: string[] }[];
  notApplicable: { action: string; type: UcaType; reason: string }[];
  constraints: { id: string; text: string; ucas: string[]; refs: string[] }[];
};
```

`factory/gates/g1.ts`:

```ts
import { UCA_TYPES, type Analysis } from "./analysis";

export type IONames = { inputs: string[]; outputs: string[] };

/** Extract the string arrays of `export const IO = { inputs: [...], outputs: [...] }`. */
export function readIO(src: string): IONames {
  const pick = (key: string) => {
    const m = src.match(new RegExp(`${key}\\s*:\\s*\\[([^\\]]*)\\]`));
    return m ? [...m[1].matchAll(/["']([^"']+)["']/g)].map((x) => x[1]) : [];
  };
  return { inputs: pick("inputs"), outputs: pick("outputs") };
}

const ARRAY_FIELDS = ["controllers", "losses", "hazards", "controlActions", "ucas", "notApplicable", "constraints"];

export function checkAnalysis(raw: unknown, io: IONames): string[] {
  if (typeof raw !== "object" || raw === null || ARRAY_FIELDS.some((f) => !Array.isArray((raw as any)[f]))) {
    return ["analysis must be a JSON object with array fields"];
  }
  const a = raw as Analysis;
  const errs: string[] = [];

  const ids = [...a.losses, ...a.hazards, ...a.controlActions, ...a.ucas, ...a.constraints].map((x) => x.id);
  for (const id of new Set(ids)) if (ids.filter((x) => x === id).length > 1) errs.push(`duplicate id ${id}`);

  const lossIds = new Set(a.losses.map((x) => x.id));
  const hazardIds = new Set(a.hazards.map((x) => x.id));
  const ucaIds = new Set(a.ucas.map((x) => x.id));
  const controllers = new Map(a.controllers.map((c) => [c.id, c]));
  const actions = new Map(a.controlActions.map((c) => [c.id, c]));

  for (const h of a.hazards) {
    if (h.losses.length === 0) errs.push(`${h.id} links to no loss`);
    for (const l of h.losses) if (!lossIds.has(l)) errs.push(`${h.id} refers to unknown loss ${l}`);
  }

  for (const ca of a.controlActions) {
    const c = controllers.get(ca.controller);
    if (!c) {
      errs.push(`${ca.id} refers to unknown controller ${ca.controller}`);
      continue;
    }
    if (!c.implemented && (!ca.event || !io.inputs.includes(ca.event))) {
      errs.push(`${ca.id} belongs to an external controller but has no valid input event`);
    }
  }

  for (const u of a.ucas) {
    if (!actions.has(u.action)) errs.push(`${u.id} refers to unknown action ${u.action}`);
    if (!UCA_TYPES.includes(u.type)) errs.push(`${u.id} has invalid type ${u.type}`);
    if (u.hazards.length === 0) errs.push(`${u.id} links to no hazard`);
    for (const h of u.hazards) if (!hazardIds.has(h)) errs.push(`${u.id} refers to unknown hazard ${h}`);
  }

  for (const n of a.notApplicable) {
    if (!n.reason || n.reason.trim() === "") errs.push(`notApplicable ${n.action} x ${n.type} needs a reason`);
  }

  for (const ca of a.controlActions) {
    for (const t of UCA_TYPES) {
      const covered =
        a.ucas.some((u) => u.action === ca.id && u.type === t) ||
        a.notApplicable.some((n) => n.action === ca.id && n.type === t);
      if (!covered) errs.push(`${ca.id} x ${t} has neither a UCA nor a notApplicable entry`);
    }
  }

  const known = new Set([...io.inputs.map((n) => `input.${n}`), ...io.outputs.map((n) => `output.${n}`)]);
  for (const sc of a.constraints) {
    for (const u of sc.ucas) if (!ucaIds.has(u)) errs.push(`${sc.id} refers to unknown UCA ${u}`);
    for (const r of sc.refs) if (!known.has(r)) errs.push(`${sc.id} refs unknown name ${r}`);
    if (!sc.refs.some((r) => r.startsWith("output."))) errs.push(`${sc.id} must reference at least one output`);
  }
  for (const u of a.ucas) {
    if (!a.constraints.some((sc) => sc.ucas.includes(u.id))) errs.push(`${u.id} is not covered by any constraint`);
  }

  const n = a.controlActions.length;
  if (n < 2 || n > 4) errs.push(`controlActions must number 2..4 (got ${n})`);
  const m = a.constraints.length;
  if (m < 1 || m > 8) errs.push(`constraints must number 1..8 (got ${m})`);

  return errs;
}
```

- [ ] **Step 4: 通ることを確認する**

Run: `npx vitest run factory/gates/g1.test.ts`
Expected: PASS(10件)

- [ ] **Step 5: コミット**

```bash
git add factory/gates/
git commit -m "feat: add G1 structural check for STPA analysis"
```

---

### Task 3: G0、G2、G3と、隠しテストの強さの測定

**Files:**
- Create: `factory/lib/tsc.ts`
- Create: `factory/gates/run-gates.ts`
- Test: `factory/gates/run-gates.test.ts`

**Interfaces:**
- Consumes: `assemble`、`HARNESS_PATH`、`FIXTURE_DIR`、`runVitest`、`VitestResult`(Task 1)、`readIO`(Task 2)
- Produces(引数の `art` は工程の成果物ディレクトリで、`interface.ts`、`SC-*.test.ts`、`mutant.SC-*.ts`、`impl.ts` を平置きする。`holdoutDir` は隠しテストのディレクトリ。`scratch` はゲート用の一時ディレクトリ):
  - `typecheck(files: string[]): Promise<string[]>`(エラー行の配列)
  - `g0(art: string, holdoutDir: string, scratch: string): Promise<string[]>`
  - `g2(art: string, scratch: string): Promise<string[]>`
  - `g3(art: string, holdoutDir: string, scratch: string): Promise<{ errors: string[]; symptoms: string[] }>`。`errors` は工程3に返す具体的な理由。`symptoms` は隠しテストの失敗タイトル(`final.test.ts` を除く)
  - `finalCheck(art: string, holdoutDir: string, scratch: string): Promise<boolean>`
  - `killRate(art: string, holdoutDir: string, scratch: string): Promise<{ killed: number; total: number }>`
  - `scIds(art: string): string[]`(`SC-*.test.ts` から `SC-n` を昇順で)

- [ ] **Step 1: 失敗するテストを書く**

`factory/gates/run-gates.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { cpSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { FIXTURE_DIR } from "../lib/workspace";
import { g0, g2, g3, finalCheck, killRate } from "./run-gates";

const root = join(process.cwd(), "runs", "_test", "gates");
const art = join(root, "art");
const holdout = join(root, "holdout");
const scratch = join(root, "scratch");

beforeEach(() => {
  rmSync(root, { recursive: true, force: true });
  mkdirSync(art, { recursive: true });
  for (const f of ["interface.ts", "impl.ts", "mutant.SC-1.ts", "SC-1.test.ts"]) {
    cpSync(join(FIXTURE_DIR, f), join(art, f));
  }
  cpSync(join(FIXTURE_DIR, "holdout"), holdout, { recursive: true });
});

describe("gates on the lamp fixture", () => {
  it("g0 accepts a typed interface with holdout tests", async () => {
    expect(await g0(art, holdout, scratch)).toEqual([]);
  });

  it("g0 rejects an interface without IO", async () => {
    writeFileSync(join(art, "interface.ts"), "export type Event = { type: 'x' };\nexport type Output = {};\n");
    expect(await g0(art, holdout, scratch)).toContain("interface.ts must export Event, Output and IO");
  });

  it("g2 passes when the mutant is killed", async () => {
    expect(await g2(art, scratch)).toEqual([]);
  });

  it("g2 fails when the mutant survives", async () => {
    cpSync(join(FIXTURE_DIR, "impl.ts"), join(art, "mutant.SC-1.ts"));
    expect(await g2(art, scratch)).toEqual(["mutant.SC-1.ts was not killed by SC-1.test.ts"]);
  });

  it("g3 passes the correct impl", async () => {
    expect(await g3(art, holdout, scratch)).toEqual({ errors: [], symptoms: [] });
  });

  it("g3 reports AI test failures as errors and holdout failures as symptoms", async () => {
    cpSync(join(FIXTURE_DIR, "mutant.SC-1.ts"), join(art, "impl.ts"));
    const r = await g3(art, holdout, scratch);
    expect(r.errors[0]).toContain("does not light while overheated");
    expect(r.symptoms).toEqual(["過熱が解消すると、点灯の要求が残っていればランプが点く"]);
  });

  it("finalCheck runs only final.test.ts", async () => {
    expect(await finalCheck(art, holdout, scratch)).toBe(true);
  });

  it("killRate counts mutants killed by holdout tests", async () => {
    expect(await killRate(art, holdout, scratch)).toEqual({ killed: 1, total: 1 });
  });
});
```

注:mutant.SC-1.ts は過熱を無視するので、h1(過熱の解消)の2番目の出力が `on` になり、隠しテストでも落ちる。

- [ ] **Step 2: 失敗を確認する**

Run: `npx vitest run factory/gates/run-gates.test.ts`
Expected: FAIL(`./run-gates` が見つからない)

- [ ] **Step 3: 実装する**

`factory/lib/tsc.ts`:

```ts
import { spawn } from "node:child_process";

/** Type-check the given files in strict mode; returns error lines (empty when clean). */
export function typecheck(files: string[]): Promise<string[]> {
  const args = [
    "tsc", "--noEmit", "--strict", "--skipLibCheck",
    "--target", "ES2022", "--module", "ESNext", "--moduleResolution", "Bundler",
    "--types", "node", ...files,
  ];
  return new Promise((resolvePromise) => {
    const child = spawn("npx", args);
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    child.on("close", (code) => {
      resolvePromise(code === 0 ? [] : out.split("\n").filter((l) => l.includes("error TS")));
    });
  });
}
```

`factory/gates/run-gates.ts`:

```ts
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { assemble, HARNESS_PATH } from "../lib/workspace";
import { runVitest } from "../lib/vitest";
import { typecheck } from "../lib/tsc";
import { readIO } from "./g1";

const FINAL = "final.test.ts";

export function scIds(art: string): string[] {
  return readdirSync(art)
    .map((f) => f.match(/^(SC-\d+)\.test\.ts$/)?.[1])
    .filter((x): x is string => Boolean(x))
    .sort((a, b) => Number(a.slice(3)) - Number(b.slice(3)));
}

const holdoutFiles = (dir: string, withFinal: boolean) =>
  existsSync(dir)
    ? readdirSync(dir).filter((f) => f.endsWith(".test.ts") && (withFinal || f !== FINAL))
    : [];

function base(art: string, impl: string): Record<string, string> {
  return { "interface.ts": join(art, "interface.ts"), "harness.ts": HARNESS_PATH, "impl.ts": impl };
}

export async function g0(art: string, holdoutDir: string, scratch: string): Promise<string[]> {
  const iface = join(art, "interface.ts");
  if (!existsSync(iface)) return ["interface.ts is missing"];
  const src = readFileSync(iface, "utf8");
  const errs: string[] = [];
  if (!/export type Event\b/.test(src) || !/export type Output\b/.test(src) || !/export const IO\b/.test(src)) {
    errs.push("interface.ts must export Event, Output and IO");
  }
  const io = readIO(src);
  if (io.inputs.length === 0 || io.outputs.length === 0) errs.push("IO.inputs and IO.outputs must be non-empty");
  errs.push(...(await typecheck([iface])));
  const all = holdoutFiles(holdoutDir, true);
  if (all.length < 3 || all.length > 8) errs.push(`holdout must have 3..8 test files (got ${all.length})`);
  if (!all.includes(FINAL)) errs.push("holdout/final.test.ts is missing");
  return errs;
}

export async function g2(art: string, scratch: string): Promise<string[]> {
  const errs: string[] = [];
  const ids = scIds(art);
  if (ids.length === 0) return ["no SC-n.test.ts files were written"];
  for (const id of ids) {
    const mutant = join(art, `mutant.${id}.ts`);
    if (!existsSync(mutant)) {
      errs.push(`mutant.${id}.ts is missing`);
      continue;
    }
    const dir = join(scratch, `g2-${id}`);
    assemble(dir, { ...base(art, mutant), [`${id}.test.ts`]: join(art, `${id}.test.ts`) });
    const r = await runVitest(dir);
    if (r.crashed) errs.push(`${id}.test.ts could not run against mutant.${id}.ts`);
    else if (r.ok) errs.push(`mutant.${id}.ts was not killed by ${id}.test.ts`);
  }
  return errs;
}

export async function g3(
  art: string,
  holdoutDir: string,
  scratch: string,
): Promise<{ errors: string[]; symptoms: string[] }> {
  const impl = join(art, "impl.ts");
  if (!existsSync(impl)) return { errors: ["impl.ts is missing"], symptoms: [] };
  const typeErrs = await typecheck([impl, join(art, "interface.ts")]);
  if (typeErrs.length > 0) return { errors: typeErrs, symptoms: [] };

  const own = join(scratch, "g3-own");
  const tests = Object.fromEntries(scIds(art).map((id) => [`${id}.test.ts`, join(art, `${id}.test.ts`)]));
  assemble(own, { ...base(art, impl), ...tests });
  const r1 = await runVitest(own);
  if (!r1.ok) {
    const errors = r1.crashed
      ? ["the SC tests could not run against impl.ts"]
      : r1.failures.map((f) => `${f.file}: ${f.title}\n${f.message.split("\n")[0]}`);
    return { errors, symptoms: [] };
  }

  const hold = join(scratch, "g3-holdout");
  const files = Object.fromEntries(holdoutFiles(holdoutDir, false).map((f) => [f, join(holdoutDir, f)]));
  assemble(hold, { ...base(art, impl), ...files });
  const r2 = await runVitest(hold);
  if (r2.crashed) return { errors: [], symptoms: ["実装が想定された入出力の形で動かない"] };
  return { errors: [], symptoms: r2.failures.map((f) => f.title) };
}

export async function finalCheck(art: string, holdoutDir: string, scratch: string): Promise<boolean> {
  const dir = join(scratch, "final");
  assemble(dir, { ...base(art, join(art, "impl.ts")), [FINAL]: join(holdoutDir, FINAL) });
  return (await runVitest(dir)).ok;
}

export async function killRate(
  art: string,
  holdoutDir: string,
  scratch: string,
): Promise<{ killed: number; total: number }> {
  const files = Object.fromEntries(holdoutFiles(holdoutDir, true).map((f) => [f, join(holdoutDir, f)]));
  let killed = 0;
  const ids = scIds(art).filter((id) => existsSync(join(art, `mutant.${id}.ts`)));
  for (const id of ids) {
    const dir = join(scratch, `kill-${id}`);
    assemble(dir, { ...base(art, join(art, `mutant.${id}.ts`)), ...files });
    const r = await runVitest(dir);
    if (!r.ok && !r.crashed) killed++;
  }
  return { killed, total: ids.length };
}
```

- [ ] **Step 4: 通ることを確認する**

Run: `npx vitest run factory/gates/run-gates.test.ts`
Expected: PASS(8件)

- [ ] **Step 5: コミット**

```bash
git add factory/lib/tsc.ts factory/gates/run-gates.ts factory/gates/run-gates.test.ts
git commit -m "feat: add G0/G2/G3 gates, final check and holdout kill rate"
```

---

### Task 4: Agentの型と `claude -p` の呼び出し

**Files:**
- Create: `factory/lib/agent.ts`
- Test: `factory/lib/agent.test.ts`

**Interfaces:**
- Produces:
  - `type AgentRequest = { stage: string; cwd: string; prompt: string; maxTurns: number; logFile: string; denyPaths: string[] }`
  - `type Agent = (req: AgentRequest) => Promise<{ ok: boolean }>`
  - `claudeArgs(req: AgentRequest): string[]`(テスト用に公開)
  - `claudeAgent: Agent`

- [ ] **Step 1: 失敗するテストを書く**

`factory/lib/agent.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { claudeArgs } from "./agent";

describe("claudeArgs", () => {
  it("builds a headless call with turn limit and deny rules", () => {
    const args = claudeArgs({
      stage: "analyze",
      cwd: "/w",
      prompt: "do it",
      maxTurns: 30,
      logFile: "/w/log.json",
      denyPaths: ["/repo/runs/x/private"],
    });
    expect(args.slice(0, 2)).toEqual(["-p", "do it"]);
    expect(args).toContain("--max-turns");
    expect(args[args.indexOf("--max-turns") + 1]).toBe("30");
    expect(args[args.indexOf("--permission-mode") + 1]).toBe("acceptEdits");
    const settings = JSON.parse(args[args.indexOf("--settings") + 1]);
    expect(settings.permissions.deny).toEqual([
      "Read(//repo/runs/x/private/**)",
      "Edit(//repo/runs/x/private/**)",
    ]);
  });
});
```

- [ ] **Step 2: 失敗を確認する**

Run: `npx vitest run factory/lib/agent.test.ts`
Expected: FAIL(`./agent` が見つからない)

- [ ] **Step 3: 実装する**

`factory/lib/agent.ts`:

```ts
import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";

export type AgentRequest = {
  stage: string;
  cwd: string;
  prompt: string;
  maxTurns: number;
  logFile: string;
  denyPaths: string[];
};

export type Agent = (req: AgentRequest) => Promise<{ ok: boolean }>;

const ALLOWED = ["Read", "Write", "Edit", "Glob", "Grep", "Bash(npx vitest:*)", "Bash(npx tsc:*)"];

export function claudeArgs(req: AgentRequest): string[] {
  const deny = req.denyPaths.flatMap((p) => [`Read(/${p}/**)`, `Edit(/${p}/**)`]);
  return [
    "-p", req.prompt,
    "--max-turns", String(req.maxTurns),
    "--output-format", "json",
    "--permission-mode", "acceptEdits",
    "--allowedTools", ALLOWED.join(","),
    "--settings", JSON.stringify({ permissions: { deny } }),
  ];
}

/** Run one headless Claude Code session in req.cwd and write its JSON result to req.logFile. */
export const claudeAgent: Agent = (req) =>
  new Promise((resolvePromise) => {
    const log = createWriteStream(req.logFile);
    const child = spawn("claude", claudeArgs(req), { cwd: req.cwd });
    child.stdout.pipe(log);
    child.stderr.pipe(log);
    child.on("close", (code) => resolvePromise({ ok: code === 0 }));
  });
```

注:絶対パス `/repo/x` は先頭に `/` を1つ足して `//repo/x` にする(Claude Codeの権限ルールで絶対パスを表す書き方)。

- [ ] **Step 4: 通ることを確認する**

Run: `npx vitest run factory/lib/agent.test.ts`
Expected: PASS

- [ ] **Step 5: 実際に1回呼んで確かめる(トークンを少し使う)**

```bash
mkdir -p runs/_smoke && npx tsx -e '
import { claudeAgent } from "./factory/lib/agent.ts";
const r = await claudeAgent({ stage: "smoke", cwd: "runs/_smoke", prompt: "Create a file named ok.txt containing ok.", maxTurns: 5, logFile: "runs/_smoke/log.json", denyPaths: [] });
console.log(r);'
cat runs/_smoke/ok.txt
```

Expected: `{ ok: true }` と `ok`

- [ ] **Step 6: コミット**

```bash
git add factory/lib/agent.ts factory/lib/agent.test.ts
git commit -m "feat: add headless claude agent with deny rules for holdout"
```

---

### Task 5: 進行役(工程、差し戻し、記録)

**Files:**
- Create: `factory/prompts.ts`(プロンプトの読み込みと組み立て。本文はTask 6のMarkdown)
- Create: `factory/orchestrator.ts`
- Test: `factory/orchestrator.test.ts`

**Interfaces:**
- Consumes: `Agent`、`AgentRequest`(Task 4)、`g0`、`g2`、`g3`、`finalCheck`、`killRate`(Task 3)、`checkAnalysis`、`readIO`(Task 2)、`FIXTURE_DIR`(Task 1)
- Produces:
  - `type Report = { runDir: string; result: "passed" | "failed" | "awaitingReview"; stages: StageRecord[]; backRoutes: number; finalPassed: boolean | null; killRate: { killed: number; total: number } | null; startedAt: string; finishedAt: string }`
  - `type StageRecord = { stage: StageName; attempt: number; errors: string[]; symptoms?: string[] }`
  - `type StageName = "holdout" | "analyze" | "tests" | "build"`
  - `runFactory(opts: { brief: string; runDir: string; agent: Agent; reviewHoldout?: boolean }): Promise<Report>`
  - `buildPrompt(stage: StageName, feedback: string[]): string`(`factory/prompts.ts`)

ディレクトリ:

- `runDir/art/`:成果物(平置き)
- `runDir/private/holdout/`:隠しテスト(工程1〜3から読めない)
- `runDir/ws/<stage>-<n>/`:工程の作業ディレクトリ
- `runDir/scratch/`:ゲート用
- `runDir/logs/<stage>-<n>.json`:`claude -p` の出力
- `runDir/report.json`

工程0の成果物が `art/interface.ts` と `private/holdout/` にすでにあれば、工程0を飛ばす(`--review-holdout` で止めた後の再開)。

- [ ] **Step 1: プロンプトのローダーを書く**

`factory/prompts.ts`:

```ts
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export type StageName = "holdout" | "analyze" | "tests" | "build";

const dir = join(dirname(fileURLToPath(import.meta.url)), "prompts");

export function buildPrompt(stage: StageName, feedback: string[]): string {
  const body = readFileSync(join(dir, `${stage}.md`), "utf8");
  if (feedback.length === 0) return body;
  return `${body}\n\n## 前回の試行で見つかった問題\n\n${feedback.map((f) => `- ${f}`).join("\n")}\n`;
}
```

Task 6で本文を書くまでテストが落ちないよう、仮のファイルを置く。

```bash
mkdir -p factory/prompts
for s in holdout analyze tests build; do echo "# $s" > factory/prompts/$s.md; done
echo "# STPA" > factory/stpa-guide.md
```

- [ ] **Step 2: 失敗するテストを書く**

偽のAgentは、工程ごとにランプのフィクスチャを作業ディレクトリへ書く。`plan` で「何回目に何を書くか」を変えて、差し戻しを再現する。

`factory/orchestrator.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { cpSync, existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { FIXTURE_DIR } from "./lib/workspace";
import type { Agent, AgentRequest } from "./lib/agent";
import { runFactory } from "./orchestrator";

const runDir = join(process.cwd(), "runs", "_test", "orch");
const brief = join(FIXTURE_DIR, "interface.ts"); // any file works as a brief for the fake agent
const fx = (f: string) => join(FIXTURE_DIR, f);

type Writes = Record<string, string>; // workspace-relative path -> fixture file
const good: Record<string, Writes> = {
  holdout: {
    "interface.ts": "interface.ts",
    holdout: "holdout",
  },
  analyze: { "analysis.json": "analysis.json" },
  tests: { "SC-1.test.ts": "SC-1.test.ts", "mutant.SC-1.ts": "mutant.SC-1.ts" },
  build: { "impl.ts": "impl.ts" },
};

function fakeAgent(plan: (stage: string, call: number) => Writes, seen: AgentRequest[]): Agent {
  const calls: Record<string, number> = {};
  return async (req) => {
    seen.push(req);
    calls[req.stage] = (calls[req.stage] ?? 0) + 1;
    for (const [rel, src] of Object.entries(plan(req.stage, calls[req.stage]))) {
      cpSync(fx(src), join(req.cwd, rel), { recursive: true });
    }
    return { ok: true };
  };
}

beforeEach(() => rmSync(runDir, { recursive: true, force: true }));

describe("runFactory", () => {
  it("passes end to end on the happy path", async () => {
    const seen: AgentRequest[] = [];
    const r = await runFactory({ brief, runDir, agent: fakeAgent((s) => good[s], seen) });
    expect(r.result).toBe("passed");
    expect(r.finalPassed).toBe(true);
    expect(r.killRate).toEqual({ killed: 1, total: 1 });
    expect(seen.map((s) => s.stage)).toEqual(["holdout", "analyze", "tests", "build"]);
    expect(existsSync(join(runDir, "private", "holdout", "final.test.ts"))).toBe(true);
    expect(existsSync(join(runDir, "ws", "build-1", "final.test.ts"))).toBe(false);
    expect(seen[1].denyPaths).toEqual([join(runDir, "private")]);
    expect(JSON.parse(readFileSync(join(runDir, "report.json"), "utf8")).result).toBe("passed");
  });

  it("retries a stage with concrete G1 errors", async () => {
    const seen: AgentRequest[] = [];
    const plan = (s: string, n: number) =>
      s === "analyze" && n === 1 ? { "analysis.json": "SC-1.test.ts" } : good[s];
    const r = await runFactory({ brief, runDir, agent: fakeAgent(plan, seen) });
    expect(r.result).toBe("passed");
    const second = seen.filter((s) => s.stage === "analyze")[1];
    expect(second.prompt).toContain("analysis.json is not valid JSON");
  });

  it("routes holdout symptoms back to analysis", async () => {
    const seen: AgentRequest[] = [];
    // First build passes the SC test but breaks recovery after overheat.
    const plan = (s: string, n: number) =>
      s === "build" && n === 1 ? { "impl.ts": "stuck-off.impl.ts" } : good[s];
    const r = await runFactory({ brief, runDir, agent: fakeAgent(plan, seen) });
    expect(r.result).toBe("passed");
    expect(r.backRoutes).toBe(1);
    const reAnalyze = seen.filter((s) => s.stage === "analyze")[1];
    expect(reAnalyze.prompt).toContain("過熱が解消すると、点灯の要求が残っていればランプが点く");
    expect(reAnalyze.prompt).not.toContain("h1.test.ts");
  });

  it("stops after holdout generation when review is requested, then resumes", async () => {
    const seen: AgentRequest[] = [];
    const agent = fakeAgent((s) => good[s], seen);
    const r1 = await runFactory({ brief, runDir, agent, reviewHoldout: true });
    expect(r1.result).toBe("awaitingReview");
    const r2 = await runFactory({ brief, runDir, agent });
    expect(r2.result).toBe("passed");
    expect(seen.filter((s) => s.stage === "holdout")).toHaveLength(1);
  });

  it("fails after 3 attempts of the same stage", async () => {
    const seen: AgentRequest[] = [];
    const plan = (s: string) => (s === "tests" ? { "SC-1.test.ts": "SC-1.test.ts", "mutant.SC-1.ts": "impl.ts" } : good[s]);
    const r = await runFactory({ brief, runDir, agent: fakeAgent(plan, seen) });
    expect(r.result).toBe("failed");
    expect(seen.filter((s) => s.stage === "tests")).toHaveLength(3);
  });
});
```

差し戻し用のフィクスチャ `factory/__fixtures__/lamp/stuck-off.impl.ts` を足す(SC-1は通るが、過熱が一度でも起きると二度と点かない):

```ts
import type { Event, Output } from "./interface";

type State = { want: boolean; tripped: boolean };

export const initialState = (): State => ({ want: false, tripped: false });

export function step(s: State, e: Event): { state: State; output: Output } {
  const n = { ...s };
  if (e.type === "user.on") n.want = true;
  if (e.type === "user.off") n.want = false;
  if (e.type === "sensor.overheat" && e.active) n.tripped = true;
  return { state: n, output: { lamp: n.want && !n.tripped ? "on" : "off" } };
}
```

- [ ] **Step 3: 失敗を確認する**

Run: `npx vitest run factory/orchestrator.test.ts`
Expected: FAIL(`./orchestrator` が見つからない)

- [ ] **Step 4: 実装する**

`factory/orchestrator.ts`:

```ts
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Agent } from "./lib/agent";
import { HARNESS_PATH } from "./lib/workspace";
import { checkAnalysis, readIO } from "./gates/g1";
import { g0, g2, g3, finalCheck, killRate, scIds } from "./gates/run-gates";
import { buildPrompt, type StageName } from "./prompts";

export type StageRecord = { stage: StageName; attempt: number; errors: string[]; symptoms?: string[] };
export type Report = {
  runDir: string;
  result: "passed" | "failed" | "awaitingReview";
  stages: StageRecord[];
  backRoutes: number;
  finalPassed: boolean | null;
  killRate: { killed: number; total: number } | null;
  startedAt: string;
  finishedAt: string;
};

const MAX_ATTEMPTS = 3;
const MAX_BACK_ROUTES = 2;
const MAX_TURNS: Record<StageName, number> = { holdout: 40, analyze: 40, tests: 60, build: 60 };
const STPA_GUIDE = join(dirname(fileURLToPath(import.meta.url)), "stpa-guide.md");

type Opts = { brief: string; runDir: string; agent: Agent; reviewHoldout?: boolean };

export async function runFactory(opts: Opts): Promise<Report> {
  const { runDir, agent } = opts;
  const art = join(runDir, "art");
  const priv = join(runDir, "private");
  const holdoutDir = join(priv, "holdout");
  const scratch = join(runDir, "scratch");
  for (const d of [art, priv, join(runDir, "ws"), join(runDir, "logs"), scratch]) mkdirSync(d, { recursive: true });

  const report: Report = {
    runDir, result: "failed", stages: [], backRoutes: 0, finalPassed: null, killRate: null,
    startedAt: new Date().toISOString(), finishedAt: "",
  };
  const counters: Partial<Record<StageName, number>> = {};
  const save = () => {
    report.finishedAt = new Date().toISOString();
    writeFileSync(join(runDir, "report.json"), JSON.stringify(report, null, 2));
    return report;
  };

  /** Run one stage up to MAX_ATTEMPTS times; `inputs` maps workspace paths to sources; returns success. */
  async function stage(
    name: StageName,
    inputs: () => Record<string, string>,
    collect: (ws: string) => void,
    gate: () => Promise<string[]>,
    initialFeedback: string[] = [],
  ): Promise<boolean> {
    let feedback = initialFeedback;
    for (let i = 1; i <= MAX_ATTEMPTS; i++) {
      const n = (counters[name] = (counters[name] ?? 0) + 1);
      const ws = join(runDir, "ws", `${name}-${n}`);
      rmSync(ws, { recursive: true, force: true });
      mkdirSync(ws, { recursive: true });
      for (const [rel, src] of Object.entries(inputs())) cpSync(src, join(ws, rel), { recursive: true });
      const res = await agent({
        stage: name, cwd: ws, prompt: buildPrompt(name, feedback), maxTurns: MAX_TURNS[name],
        logFile: join(runDir, "logs", `${name}-${n}.json`), denyPaths: [priv],
      });
      collect(ws);
      const errors = res.ok ? await gate() : [`claude exited with an error in stage ${name}`];
      report.stages.push({ stage: name, attempt: n, errors });
      save();
      if (errors.length === 0) return true;
      feedback = errors;
    }
    return false;
  }

  const copyOut = (ws: string, pattern: RegExp) => {
    for (const f of readdirSync(ws)) if (pattern.test(f)) cpSync(join(ws, f), join(art, f));
  };

  // Stage 0: interface and holdout tests (skipped when already present).
  if (!(existsSync(join(art, "interface.ts")) && existsSync(holdoutDir))) {
    const ok = await stage(
      "holdout",
      () => ({ "brief.md": opts.brief }),
      (ws) => {
        copyOut(ws, /^interface\.ts$/);
        rmSync(holdoutDir, { recursive: true, force: true });
        if (existsSync(join(ws, "holdout"))) renameSync(join(ws, "holdout"), holdoutDir);
      },
      () => g0(art, holdoutDir, scratch),
    );
    if (!ok) return save();
    if (opts.reviewHoldout) {
      report.result = "awaitingReview";
      return save();
    }
  }

  const io = () => readIO(readFileSync(join(art, "interface.ts"), "utf8"));
  const clearArt = (pattern: RegExp) => {
    for (const f of readdirSync(art)) if (pattern.test(f)) rmSync(join(art, f));
  };
  let symptoms: string[] = [];

  for (let round = 0; round <= MAX_BACK_ROUTES; round++) {
    const analyzed = await stage(
      "analyze",
      () => ({ "brief.md": opts.brief, "stpa-guide.md": STPA_GUIDE, "interface.ts": join(art, "interface.ts"),
        ...(existsSync(join(art, "analysis.json")) ? { "analysis.json": join(art, "analysis.json") } : {}) }),
      (ws) => copyOut(ws, /^analysis\.json$/),
      async () => {
        const p = join(art, "analysis.json");
        if (!existsSync(p)) return ["analysis.json is missing"];
        try {
          return checkAnalysis(JSON.parse(readFileSync(p, "utf8")), io());
        } catch {
          return ["analysis.json is not valid JSON"];
        }
      },
      symptoms.map((s) => `実装は分析から導いたテストに合格したが、次の症状が観察された:${s}`),
    );
    if (!analyzed) return save();

    clearArt(/^(SC-\d+\.test\.ts|mutant\.SC-\d+\.ts|impl\.ts)$/);
    const tested = await stage(
      "tests",
      () => ({ "analysis.json": join(art, "analysis.json"), "interface.ts": join(art, "interface.ts"), "harness.ts": HARNESS_PATH }),
      (ws) => copyOut(ws, /^(SC-\d+\.test\.ts|mutant\.SC-\d+\.ts)$/),
      async () => {
        const a = JSON.parse(readFileSync(join(art, "analysis.json"), "utf8"));
        const have = new Set(scIds(art));
        const missing = a.constraints.map((c: { id: string }) => c.id).filter((id: string) => !have.has(id));
        return [...missing.map((id: string) => `${id}.test.ts is missing`), ...(await g2(art, scratch))];
      },
    );
    if (!tested) return save();

    let holdoutSymptoms: string[] = [];
    const built = await stage(
      "build",
      () => ({
        "analysis.json": join(art, "analysis.json"), "interface.ts": join(art, "interface.ts"), "harness.ts": HARNESS_PATH,
        ...Object.fromEntries(scIds(art).map((id) => [`${id}.test.ts`, join(art, `${id}.test.ts`)])),
      }),
      (ws) => copyOut(ws, /^impl\.ts$/),
      async () => {
        const r = await g3(art, holdoutDir, scratch);
        holdoutSymptoms = r.symptoms;
        return r.errors;
      },
    );
    if (!built) return save();

    if (holdoutSymptoms.length === 0) {
      report.finalPassed = await finalCheck(art, holdoutDir, scratch);
      report.killRate = await killRate(art, holdoutDir, scratch);
      report.result = "passed";
      return save();
    }
    report.stages[report.stages.length - 1].symptoms = holdoutSymptoms;
    if (round === MAX_BACK_ROUTES) break;
    report.backRoutes++;
    symptoms = holdoutSymptoms;
  }
  return save();
}
```

注:`build` の再試行が使い切られるのはAIのテストや型で落ち続けたときだけ。隠しテストの症状は `errors` に入れないので、`build` は1回で抜けて工程1へ差し戻す。`final` の結果は `report.json` に残すだけで、プロンプトには入れない。

- [ ] **Step 5: 通ることを確認する**

Run: `npx vitest run factory/orchestrator.test.ts`
Expected: PASS(5件)

- [ ] **Step 6: 全テストを流してコミット**

Run: `npm test && npx tsc -p .`
Expected: すべてPASS、型エラーなし

```bash
git add factory/
git commit -m "feat: add orchestrator with stage retries, holdout back-routing and report"
```

---

### Task 6: プロンプト、STPA手順書、エレベーターの題材メモ、CLI

**Files:**
- Modify: `factory/prompts/holdout.md`、`analyze.md`、`tests.md`、`build.md`(仮ファイルを本文で置き換える)
- Modify: `factory/stpa-guide.md`
- Create: `subjects/elevator/brief.md`
- Create: `factory/run.ts`

**Interfaces:**
- Consumes: `runFactory`(Task 5)、`claudeAgent`(Task 4)

- [ ] **Step 1: `factory/prompts/holdout.md`**

```markdown
# 工程0:I/Fと隠しテストを作る

`brief.md` の題材について、次の2つを作業ディレクトリに書いてください。人に質問せず、題材メモの範囲で決めてください。

## 1. `interface.ts`

制御ソフトの入出力の型を定義します。状態の持ち方は書きません。

- `export type Event`:入力イベントのユニオン型。`type` は `"<送り手>.<名前>"`(例:`"door.obstructed"`)。時間経過は `{ type: "tick"; ms: number }`。
- `export type Output`:1ステップごとの出力のスナップショット。
- `export const IO = { inputs: [...], outputs: [...] } as const`:`inputs` はすべての `Event` の `type`。`outputs` は `Output` のキー(入れ子ならドット区切り、例:`"car.floor"`)。

実装は `initialState()` と `step(state, event) => { state, output }` を持ちます。テストからは `./harness` の `run(events: Event[]): Output[]` で呼びます。

## 2. `holdout/*.test.ts`(3〜8ファイル)

実装を知らない第三者として、題材の要求を満たすか確かめるブラックボックステストを書きます。

- import は `vitest`、`./harness`、`./interface` だけ。
- 1ファイル=1つの観点。観点は「通常の利用」「境界値」「割り込みと、その後の復帰」「同時に起きる入力」から幅広く選ぶ。
- テストのタイトル(`it` の第1引数)は、**失敗したときに観察される症状**を日本語の1文で書く。テストの名前や番号、実装の用語を入れない。例:「扉が閉まりきる前に、かごが動き出す」ではなく「扉が閉まりきるまで、かごは動かない」のように、期待する振る舞いを書く。
- 内部状態は見ない。`run()` の出力だけで判定する。
- 1本は `holdout/final.test.ts` という名前にする。最も重要な要求を、ほかのファイルと重ならない形で確かめる。

型チェックが通ることを `npx tsc --noEmit --strict interface.ts` で確かめてください。
```

- [ ] **Step 2: `factory/prompts/analyze.md`**

```markdown
# 工程1:STPAで安全分析する

`brief.md`(題材)、`interface.ts`(固定の入出力)、`stpa-guide.md`(手順)を読み、`analysis.json` を書いてください。`analysis.json` がすでにあれば、それを直してください。人に質問せず、題材メモの範囲で決めてください。

- 形式は `stpa-guide.md` の「出力形式」に従う。
- 実装するコントローラは1つだけ(`implemented: true`)。ほかのコントローラ(利用者、センサ、外部装置)は `implemented: false` にし、その制御アクションには対応する入力イベントを `event` に書く。
- 制御アクションは2〜4個、安全制約(SC)は3〜8本。
- すべての制御アクションに、UCAの4分類を当てる。該当しない分類は `notApplicable` に理由を書く。
- SCの `refs` には `interface.ts` の `IO` にある名前を `input.<名前>` / `output.<名前>` で書く。どのSCも、実装するコントローラの出力を1つ以上含める。
- 割り込みが終わったあとに何を元に戻し、何を捨てるかを必ず検討する(`wrongDuration` の分類で扱う)。
```

- [ ] **Step 3: `factory/prompts/tests.md`**

```markdown
# 工程2:安全制約ごとにテストと壊した実装を作る

`analysis.json` の `constraints` の各 SC-n について、作業ディレクトリに次の2つを書いてください。

1. `SC-n.test.ts`:SC-nが守られていることを確かめるテスト。
   - import は `vitest`、`fast-check`、`./harness`、`./interface` だけ。
   - 状況の組み合わせが多いものは、fast-checkで入力イベント列を生成して確かめる(`fc.assert(fc.property(...))`)。
2. `mutant.SC-n.ts`:SC-nだけを破り、ほかはもっともらしく動く実装。
   - `import type { Event, Output } from "./interface"`、`export const initialState`、`export function step(state, event): { state, output }`。

`mutant.SC-n.ts` を `impl.ts` にコピーして `npx vitest run SC-n.test.ts` を実行し、テストが**落ちる**ことを確かめてください。確かめた後、`impl.ts` は消してください。
```

- [ ] **Step 4: `factory/prompts/build.md`**

```markdown
# 工程3:実装する

`analysis.json`、`interface.ts`、`SC-*.test.ts` を読み、`impl.ts` を書いてください。

- `import type { Event, Output } from "./interface"`、`export const initialState: () => State`、`export function step(state: State, event: Event): { state: State; output: Output }`。
- 純粋関数にする。時刻は `tick` イベントだけで進める。
- `npx vitest run` と `npx tsc --noEmit --strict impl.ts interface.ts` が通るまで直す。
- テストを変更・削除しない。
```

- [ ] **Step 5: `factory/stpa-guide.md`**

```markdown
# STPA手順書

## 手順

1. **ロス(L)**:利害関係者にとって受け入れられない損失を2〜4個挙げる(人の負傷、設備の損傷など)。
2. **ハザード(H)**:ロスにつながるシステムの状態を挙げ、どのロスにつながるか書く。
3. **制御構造**:コントローラ(実装する制御ソフト、利用者、センサ、外部装置)と、それぞれが出す制御アクション(CA)を挙げる。
4. **UCA**:各CAに次の4分類を当て、危険になる状況(`context`)を書く。
   - `notProvided`:必要なときに提供されない
   - `providedUnsafe`:提供されると危険
   - `wrongTiming`:早すぎる、遅すぎる、順序が誤っている
   - `wrongDuration`:長すぎる継続、早すぎる停止(割り込みの後に戻らない、戻りすぎるもここ)
   該当しない分類は `notApplicable` に理由を書く。
5. **安全制約(SC)**:UCAを裏返して、実装するコントローラが守る約束にする。外部のコントローラのUCAも、実装するコントローラがどう防ぐかの約束に変える。

## 出力形式(`analysis.json`)

```json
{
  "controllers": [{ "id": "carController", "implemented": true }, { "id": "passenger", "implemented": false }],
  "losses": [{ "id": "L-1", "text": "..." }],
  "hazards": [{ "id": "H-1", "text": "...", "losses": ["L-1"] }],
  "controlActions": [
    { "id": "CA-1", "controller": "carController", "name": "move" },
    { "id": "CA-2", "controller": "passenger", "name": "call", "event": "hall.call" }
  ],
  "ucas": [{ "id": "UCA-1", "action": "CA-1", "type": "providedUnsafe", "context": "...", "hazards": ["H-1"] }],
  "notApplicable": [{ "action": "CA-1", "type": "notProvided", "reason": "..." }],
  "constraints": [{ "id": "SC-1", "text": "...", "ucas": ["UCA-1"], "refs": ["input.door.obstructed", "output.car.motion"] }]
}
```
```

- [ ] **Step 6: `subjects/elevator/brief.md`**

```markdown
# 題材:エレベーターの制御

4階建て(1〜4階)の建物にある、かご1台のエレベーターの制御ソフトを作る。

## 入力

- 乗り場の呼び出しボタン(階と上下の向き)
- かご内の行き先ボタン(階)
- 扉のセンサ(障害物あり、障害物なし)
- 火災報知器(発報、復旧)
- 時間の経過

## 出力

- かごのいる階と動き(上昇、下降、停止)
- 扉の状態(開、開きつつある、閉まりつつある、閉)
- 運転モード(通常、火災時の避難)

## 要求

- 扉が開いている間は、かごを動かさない。
- 人が挟まれそうなときは、扉を閉めない。
- 火災時は、すべての呼び出しより避難を優先する。避難階は1階。
- 呼ばれた階には、いずれ必ず行く。

## 前提

- 階の間の移動に2秒、扉の開閉にそれぞれ1秒、扉は開いてから3秒で閉め始める。
```

- [ ] **Step 7: CLI `factory/run.ts`**

```ts
import { resolve } from "node:path";
import { claudeAgent } from "./lib/agent";
import { runFactory } from "./orchestrator";

const args = process.argv.slice(2);
const brief = args.find((a) => !a.startsWith("--"));
const flag = (name: string) => args.includes(name);
const opt = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

if (!brief) {
  console.error("usage: npm run factory -- <brief.md> [--review-holdout] [--run <runDir>]");
  process.exit(2);
}

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const runDir = resolve(opt("--run") ?? `runs/${stamp}`);
console.log(`run dir: ${runDir}`);

const report = await runFactory({
  brief: resolve(brief),
  runDir,
  agent: claudeAgent,
  reviewHoldout: flag("--review-holdout"),
});

console.log(`result: ${report.result}, back-routes: ${report.backRoutes}, final: ${report.finalPassed}`);
if (report.killRate) console.log(`holdout killed ${report.killRate.killed}/${report.killRate.total} mutants`);
if (report.result === "awaitingReview") {
  console.log(`review ${runDir}/private/holdout, then rerun with --run ${runDir}`);
}
process.exit(report.result === "passed" ? 0 : report.result === "awaitingReview" ? 0 : 1);
```

- [ ] **Step 8: テストと型を確認してコミット**

Run: `npm test && npx tsc -p .`
Expected: すべてPASS

```bash
git add factory/ subjects/
git commit -m "feat: add stage prompts, STPA guide, elevator brief and CLI"
```

---

### Task 7: エレベーターで練習運転(手動、トークンを使う)

- [ ] **Step 1: 全自動で1回回す**

```bash
time npm run factory -- subjects/elevator/brief.md
```

記録すること:所要時間、`runs/<id>/report.json` の各工程の試行回数と差し戻し回数、`killRate`、`finalPassed`。

- [ ] **Step 2: 工程0の後に人が確認する版を回す**

```bash
npm run factory -- subjects/elevator/brief.md --review-holdout
# runs/<id>/private/holdout と art/interface.ts を読み、直してから再開する
npm run factory -- subjects/elevator/brief.md --run runs/<id>
```

記録すること:人が足した・直した隠しテストと、その理由。Step 1との差。

- [ ] **Step 3: ファクトリー側の不具合を直す**

プロンプトのずれ、権限の不足、ゲートの誤判定が見つかったら、それぞれ別コミットで直す。題材固有の内容をプロンプトに書き足さない。

- [ ] **Step 4: 結果をメモにしてコミット**

`docs/practice-log.md` に、Step 1と2の記録を書いてコミットする。
