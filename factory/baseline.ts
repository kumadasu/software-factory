import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Agent } from "./lib/agent";
import { assemble, HARNESS_PATH } from "./lib/workspace";
import { runVitest } from "./lib/vitest";
import { typecheck } from "./lib/tsc";
import { scIds } from "./gates/run-gates";

/**
 * Baseline experiment: build an implementation from the brief and interface only (no STPA analysis,
 * no SC tests), then score it against the holdout tests and the SC tests of a finished factory run.
 */
export type BaselineReport = {
  built: boolean;
  attempts: number;
  holdout: { failed: string[] };
  finalPassed: boolean | null;
  constraints: { id: string; failed: string[] }[];
  startedAt: string;
  finishedAt: string;
};

const MAX_ATTEMPTS = 3;
const MAX_TURNS = 60;
const PROMPT = join(dirname(fileURLToPath(import.meta.url)), "prompts", "baseline.md");

type Opts = { brief: string; runDir: string; agent: Agent };

export async function runBaseline({ brief, runDir, agent }: Opts): Promise<BaselineReport> {
  const art = join(runDir, "art");
  const priv = join(runDir, "private");
  const holdoutDir = join(priv, "holdout");
  const out = join(runDir, "baseline");
  mkdirSync(join(out, "logs"), { recursive: true });
  const impl = join(out, "impl.ts");
  const report: BaselineReport = {
    built: false, attempts: 0, holdout: { failed: [] }, finalPassed: null, constraints: [],
    startedAt: new Date().toISOString(), finishedAt: "",
  };
  const log = (msg: string) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${msg}`);

  let feedback: string[] = [];
  for (let n = 1; n <= MAX_ATTEMPTS && !report.built; n++) {
    report.attempts = n;
    const ws = join(out, `ws-${n}`);
    assemble(ws, { "brief.md": brief, "interface.ts": join(art, "interface.ts"), "harness.ts": HARNESS_PATH });
    const prompt = readFileSync(PROMPT, "utf8") +
      (feedback.length ? `\n\n## 前回の試行で見つかった問題\n\n${feedback.map((f) => `- ${f}`).join("\n")}\n` : "");
    log(`baseline attempt ${n} started`);
    const res = await agent({
      stage: "baseline", cwd: ws, prompt, maxTurns: MAX_TURNS,
      logFile: join(out, "logs", `baseline-${n}.json`), denyPaths: [priv, art],
    });
    if (res.fatal) {
      log(`stopping: ${res.fatal}`);
      break;
    }
    const src = join(ws, "impl.ts");
    feedback = !existsSync(src)
      ? ["impl.ts is missing"]
      : await typecheck([src, join(ws, "interface.ts")]);
    if (feedback.length === 0) {
      cpSync(src, impl);
      report.built = true;
    }
    log(`baseline attempt ${n}: ${feedback.length === 0 ? "built" : `${feedback.length} error(s)`}`);
  }

  if (report.built) {
    const base = { "interface.ts": join(art, "interface.ts"), "harness.ts": HARNESS_PATH, "impl.ts": impl };
    const failedTitles = async (name: string, tests: string[], dir: string) => {
      const scratch = join(out, "scratch", name);
      assemble(scratch, { ...base, ...Object.fromEntries(tests.map((t) => [t, join(dir, t)])) });
      const r = await runVitest(scratch);
      return r.crashed ? ["(crashed)"] : r.failures.map((f) => `${f.file}: ${f.title}`);
    };
    const holdout = readdirSync(holdoutDir).filter((f) => f.endsWith(".test.ts") && f !== "final.test.ts");
    report.holdout.failed = await failedTitles("holdout", holdout, holdoutDir);
    report.finalPassed = (await failedTitles("final", ["final.test.ts"], holdoutDir)).length === 0;
    for (const id of scIds(art)) {
      report.constraints.push({ id, failed: await failedTitles(id, [`${id}.test.ts`], art) });
    }
  }
  report.finishedAt = new Date().toISOString();
  writeFileSync(join(out, "report.json"), JSON.stringify(report, null, 2));
  return report;
}
