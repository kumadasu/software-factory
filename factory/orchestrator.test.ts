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
  holdout: { "interface.ts": "interface.ts", holdout: "holdout" },
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
    const plan = (s: string) =>
      s === "tests" ? { "SC-1.test.ts": "SC-1.test.ts", "mutant.SC-1.ts": "impl.ts" } : good[s];
    const r = await runFactory({ brief, runDir, agent: fakeAgent(plan, seen) });
    expect(r.result).toBe("failed");
    expect(seen.filter((s) => s.stage === "tests")).toHaveLength(3);
  });
});
