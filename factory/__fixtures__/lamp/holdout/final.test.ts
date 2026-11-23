import { it, expect } from "vitest";
import { run } from "./harness";

it("消灯を要求するとランプが消える", () => {
  const outs = run([{ type: "user.on" }, { type: "user.off" }]);
  expect(outs.at(-1)).toEqual({ lamp: "off" });
});
