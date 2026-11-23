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
