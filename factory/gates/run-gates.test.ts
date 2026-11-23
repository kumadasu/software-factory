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

  it("g3 reports AI test failures as errors", async () => {
    cpSync(join(FIXTURE_DIR, "mutant.SC-1.ts"), join(art, "impl.ts"));
    const r = await g3(art, holdout, scratch);
    expect(r.errors[0]).toContain("does not light while overheated");
    expect(r.symptoms).toEqual([]);
  });

  it("g3 reports holdout failures as symptoms only", async () => {
    cpSync(join(FIXTURE_DIR, "stuck-off.impl.ts"), join(art, "impl.ts"));
    const r = await g3(art, holdout, scratch);
    expect(r).toEqual({ errors: [], symptoms: ["過熱が解消すると、点灯の要求が残っていればランプが点く"] });
  });

  it("finalCheck runs only final.test.ts", async () => {
    expect(await finalCheck(art, holdout, scratch)).toBe(true);
  });

  it("killRate counts mutants killed by holdout tests", async () => {
    expect(await killRate(art, holdout, scratch)).toEqual({ killed: 1, total: 1 });
  });
});
