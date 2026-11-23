import { describe, it, expect } from "vitest";
import { claudeArgs } from "./agent";

describe("claudeArgs", () => {
  it("builds a headless call with turn limit and deny rules", () => {
    const args = claudeArgs({
      stage: "analyze",
      cwd: "/w",
      prompt: "do it",
      maxTurns: 30,
      logFile: "/w/log.json",
      denyPaths: ["/repo/runs/x/private"],
    });
    expect(args.slice(0, 2)).toEqual(["-p", "do it"]);
    expect(args[args.indexOf("--max-turns") + 1]).toBe("30");
    expect(args[args.indexOf("--permission-mode") + 1]).toBe("acceptEdits");
    const settings = JSON.parse(args[args.indexOf("--settings") + 1]);
    expect(settings.permissions.deny).toEqual([
      "Read(//repo/runs/x/private/**)",
      "Edit(//repo/runs/x/private/**)",
    ]);
  });
});
