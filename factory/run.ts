import { resolve } from "node:path";
import { claudeAgent } from "./lib/agent";
import { runFactory } from "./orchestrator";

const args = process.argv.slice(2);
const opt = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const runOpt = opt("--run");
const brief = args.find((a) => !a.startsWith("--") && a !== runOpt);

if (!brief) {
  console.error("usage: npm run factory -- <brief.md> [--review-holdout] [--run <runDir>]");
  process.exit(2);
}

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const runDir = resolve(runOpt ?? `runs/${stamp}`);
console.log(`run dir: ${runDir}`);

const report = await runFactory({
  brief: resolve(brief),
  runDir,
  agent: claudeAgent,
  reviewHoldout: args.includes("--review-holdout"),
});

console.log(`result: ${report.result}, back-routes: ${report.backRoutes}, final: ${report.finalPassed}`);
if (report.killRate) console.log(`holdout killed ${report.killRate.killed}/${report.killRate.total} mutants`);
if (report.result === "awaitingReview") {
  console.log(`review ${runDir}/private/holdout and ${runDir}/art/interface.ts, then rerun with --run ${runDir}`);
}
process.exit(report.result === "failed" ? 1 : 0);
