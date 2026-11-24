import { resolve } from "node:path";
import { claudeAgent } from "./lib/agent";
import { runBaseline } from "./baseline";

const [brief, runDir] = process.argv.slice(2);
if (!brief || !runDir) {
  console.error("usage: npm run baseline -- <brief.md> <finished runDir>");
  process.exit(2);
}
const r = await runBaseline({ brief: resolve(brief), runDir: resolve(runDir), agent: claudeAgent });
console.log(`built: ${r.built}, holdout failures: ${r.holdout.failed.length}, final: ${r.finalPassed}`);
for (const c of r.constraints) console.log(`${c.id}: ${c.failed.length === 0 ? "pass" : `${c.failed.length} failure(s)`}`);
process.exit(r.built ? 0 : 1);
