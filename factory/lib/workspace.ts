import { cpSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
export const HARNESS_PATH = resolve(here, "../runtime/harness.ts");
export const FIXTURE_DIR = resolve(here, "../__fixtures__/lamp");

/** Recreate `dir` and copy each source file to its workspace-relative path. */
export function assemble(dir: string, files: Record<string, string>): void {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  for (const [rel, src] of Object.entries(files)) {
    const dest = join(dir, rel);
    mkdirSync(dirname(dest), { recursive: true });
    cpSync(src, dest);
  }
}
