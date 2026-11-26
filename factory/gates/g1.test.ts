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
    expect(checkAnalysis(a, io)).toContain("constraints must number 1..16 (got 0)");
  });

  it("rejects non-object input", () => {
    expect(checkAnalysis("nope", io)).toEqual(["analysis must be a JSON object with array fields"]);
  });
});
