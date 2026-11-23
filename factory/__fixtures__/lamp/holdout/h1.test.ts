import { it, expect } from "vitest";
import { run } from "./harness";

it("過熱が解消すると、点灯の要求が残っていればランプが点く", () => {
  const outs = run([
    { type: "user.on" },
    { type: "sensor.overheat", active: true },
    { type: "sensor.overheat", active: false },
  ]);
  expect(outs.map((o) => o.lamp)).toEqual(["on", "off", "on"]);
});
