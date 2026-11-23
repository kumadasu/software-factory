import { spawn } from "node:child_process";

/** Type-check the given files in strict mode; returns error lines (empty when clean). */
export function typecheck(files: string[]): Promise<string[]> {
  const args = [
    "tsc", "--ignoreConfig", "--noEmit", "--strict", "--skipLibCheck",
    "--target", "ES2022", "--module", "ESNext", "--moduleResolution", "Bundler",
    "--types", "node", ...files,
  ];
  return new Promise((resolvePromise) => {
    const child = spawn("npx", args);
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    child.on("close", (code) => {
      if (code === 0) return resolvePromise([]);
      const lines = out.split("\n").filter((l) => l.includes("error TS"));
      resolvePromise(lines.length > 0 ? lines : [out.trim() || `tsc exited with ${code}`]);
    });
  });
}
