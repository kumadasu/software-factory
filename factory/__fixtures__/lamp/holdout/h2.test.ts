import { it, expect } from "vitest";
import { run } from "./harness";

it("点灯を要求していなければ、ランプは消えたまま", () => {
  const outs = run([{ type: "sensor.overheat", active: false }]);
  expect(outs.at(-1)).toEqual({ lamp: "off" });
});
