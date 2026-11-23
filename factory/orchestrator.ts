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
  stoppedReason?: string;
  startedAt: string;
  finishedAt: string;
};

const MAX_ATTEMPTS = 3;
const MAX_BACK_ROUTES = 2;
const MAX_TURNS: Record<StageName, number> = { holdout: 60, analyze: 40, tests: 100, build: 60 };
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
  const log = (msg: string) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${msg}`);

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
      log(`stage ${name} attempt ${n} started`);
      const res = await agent({
        stage: name, cwd: ws, prompt: buildPrompt(name, feedback), maxTurns: MAX_TURNS[name],
        logFile: join(runDir, "logs", `${name}-${n}.json`), denyPaths: [priv],
      });
      collect(ws);
      if (res.fatal) {
        report.stages.push({ stage: name, attempt: n, errors: [res.fatal] });
        report.stoppedReason = res.fatal;
        save();
        log(`stopping: ${res.fatal}`);
        return false;
      }
      const errors = res.ok ? await gate() : [`claude exited with an error in stage ${name}`];
      report.stages.push({ stage: name, attempt: n, errors });
      save();
      log(`stage ${name} attempt ${n}: ${errors.length === 0 ? "gate passed" : `${errors.length} error(s)`}`);
      if (errors.length === 0) return true;
      feedback = errors;
    }
    return false;
  }

  const copyOut = (ws: string, pattern: RegExp) => {
    for (const f of readdirSync(ws)) if (pattern.test(f)) cpSync(join(ws, f), join(art, f));
  };
  const clearArt = (pattern: RegExp) => {
    for (const f of readdirSync(art)) if (pattern.test(f)) rmSync(join(art, f));
  };

  // Stage 0: interface and holdout tests (skipped when already present, e.g. after human review).
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
  let symptoms: string[] = [];

  for (let round = 0; round <= MAX_BACK_ROUTES; round++) {
    const analyzed = await stage(
      "analyze",
      () => ({
        "brief.md": opts.brief,
        "stpa-guide.md": STPA_GUIDE,
        "interface.ts": join(art, "interface.ts"),
        ...(existsSync(join(art, "analysis.json")) ? { "analysis.json": join(art, "analysis.json") } : {}),
      }),
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
      () => ({
        "analysis.json": join(art, "analysis.json"),
        "interface.ts": join(art, "interface.ts"),
        "harness.ts": HARNESS_PATH,
      }),
      (ws) => copyOut(ws, /^(SC-\d+\.test\.ts|mutant\.SC-\d+\.ts)$/),
      async () => {
        const a = JSON.parse(readFileSync(join(art, "analysis.json"), "utf8")) as { constraints: { id: string }[] };
        const have = new Set(scIds(art));
        const missing = a.constraints.map((c) => c.id).filter((id) => !have.has(id));
        return [...missing.map((id) => `${id}.test.ts is missing`), ...(await g2(art, scratch))];
      },
    );
    if (!tested) return save();

    let holdoutSymptoms: string[] = [];
    const built = await stage(
      "build",
      () => ({
        "analysis.json": join(art, "analysis.json"),
        "interface.ts": join(art, "interface.ts"),
        "harness.ts": HARNESS_PATH,
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
      log(`passed (final: ${report.finalPassed})`);
      return save();
    }
    report.stages[report.stages.length - 1].symptoms = holdoutSymptoms;
    log(`holdout failed with ${holdoutSymptoms.length} symptom(s)`);
    if (round === MAX_BACK_ROUTES) break;
    report.backRoutes++;
    symptoms = holdoutSymptoms;
  }
  return save();
}
