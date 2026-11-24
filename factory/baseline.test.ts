import { cpSync, mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Agent, AgentRequest } from "./lib/agent";
import { FIXTURE_DIR } from "./lib/workspace";
import { runBaseline } from "./baseline";

/** A finished factory run built from the lamp fixture. */
function lampRun(): string {
  const runDir = mkdtempSync(join(tmpdir(), "baseline-"));
  const art = join(runDir, "art");
  mkdirSync(art);
  for (const f of ["interface.ts", "analysis.json", "SC-1.test.ts", "impl.ts"]) cpSync(join(FIXTURE_DIR, f), join(art, f));
  cpSync(join(FIXTURE_DIR, "holdout"), join(runDir, "private", "holdout"), { recursive: true });
  return runDir;
}

const writes = (implSrc: string, seen: AgentRequest[]): Agent => async (req) => {
  seen.push(req);
  cpSync(join(FIXTURE_DIR, implSrc), join(req.cwd, "impl.ts"));
  return { ok: true };
};

describe("runBaseline", () => {
  it("builds from the brief alone and scores the result against holdout and SC tests", async () => {
    const runDir = lampRun();
    const seen: AgentRequest[] = [];
    const r = await runBaseline({ brief: join(FIXTURE_DIR, "interface.ts"), runDir, agent: writes("stuck-off.impl.ts", seen) });
    expect(r.built).toBe(true);
    expect(r.holdout.failed.length).toBeGreaterThan(0);
    expect(r.constraints.map((c) => c.id)).toEqual(["SC-1"]);
    expect(seen[0].denyPaths).toEqual([join(runDir, "private"), join(runDir, "art")]);
  });

  it("passes everything with the reference implementation", async () => {
    const runDir = lampRun();
    const r = await runBaseline({ brief: join(FIXTURE_DIR, "interface.ts"), runDir, agent: writes("impl.ts", []) });
    expect(r.holdout.failed).toEqual([]);
    expect(r.finalPassed).toBe(true);
    expect(r.constraints).toEqual([{ id: "SC-1", failed: [] }]);
  });
});
