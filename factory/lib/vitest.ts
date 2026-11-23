import { spawn } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join, relative } from "node:path";

export type VitestFailure = { file: string; title: string; message: string };
export type VitestResult = { ok: boolean; crashed: boolean; failures: VitestFailure[] };

type JsonReport = {
  testResults: {
    name: string;
    status: string;
    assertionResults: { title: string; status: string; failureMessages: string[] }[];
  }[];
};

/** Run every *.test.ts under `dir` (dir must live inside the repo so node_modules resolve). */
export function runVitest(dir: string): Promise<VitestResult> {
  const out = join(dir, ".vitest-result.json");
  rmSync(out, { force: true });
  return new Promise((resolvePromise) => {
    const child = spawn(
      "npx",
      ["vitest", "run", "--root", dir, "--reporter=json", `--outputFile=${out}`],
      { stdio: "ignore", cwd: dir },
    );
    child.on("close", () => {
      if (!existsSync(out)) {
        resolvePromise({ ok: false, crashed: true, failures: [] });
        return;
      }
      const report = JSON.parse(readFileSync(out, "utf8")) as JsonReport;
      const failures: VitestFailure[] = [];
      let crashed = report.testResults.length === 0;
      for (const file of report.testResults) {
        const rel = relative(dir, file.name);
        if (file.assertionResults.length === 0 && file.status === "failed") crashed = true;
        for (const a of file.assertionResults) {
          if (a.status === "failed") {
            failures.push({ file: rel, title: a.title, message: a.failureMessages.join("\n") });
          }
        }
      }
      resolvePromise({ ok: !crashed && failures.length === 0, crashed, failures });
    });
  });
}
