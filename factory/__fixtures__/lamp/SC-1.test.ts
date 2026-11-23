import { describe, it, expect } from "vitest";
import { run } from "./harness";

describe("SC-1", () => {
  it("does not light while overheated", () => {
    const outs = run([{ type: "sensor.overheat", active: true }, { type: "user.on" }]);
    expect(outs.at(-1)).toEqual({ lamp: "off" });
  });
});
