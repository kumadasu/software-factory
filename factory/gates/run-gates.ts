import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { assemble, HARNESS_PATH } from "../lib/workspace";
import { runVitest } from "../lib/vitest";
import { typecheck } from "../lib/tsc";
import { readIO } from "./g1";

const FINAL = "final.test.ts";

export function scIds(art: string): string[] {
  return readdirSync(art)
    .map((f) => f.match(/^(SC-\d+)\.test\.ts$/)?.[1])
    .filter((x): x is string => Boolean(x))
    .sort((a, b) => Number(a.slice(3)) - Number(b.slice(3)));
}

const holdoutFiles = (dir: string, withFinal: boolean) =>
  existsSync(dir)
    ? readdirSync(dir).filter((f) => f.endsWith(".test.ts") && (withFinal || f !== FINAL))
    : [];

function base(art: string, impl: string): Record<string, string> {
  return { "interface.ts": join(art, "interface.ts"), "harness.ts": HARNESS_PATH, "impl.ts": impl };
}

export async function g0(art: string, holdoutDir: string, _scratch: string): Promise<string[]> {
  const iface = join(art, "interface.ts");
  if (!existsSync(iface)) return ["interface.ts is missing"];
  const src = readFileSync(iface, "utf8");
  const errs: string[] = [];
  if (!/export type Event\b/.test(src) || !/export type Output\b/.test(src) || !/export const IO\b/.test(src)) {
    errs.push("interface.ts must export Event, Output and IO");
  }
  const io = readIO(src);
  if (io.inputs.length === 0 || io.outputs.length === 0) errs.push("IO.inputs and IO.outputs must be non-empty");
  errs.push(...(await typecheck([iface])));
  const all = holdoutFiles(holdoutDir, true);
  if (all.length < 3 || all.length > 8) errs.push(`holdout must have 3..8 test files (got ${all.length})`);
  if (!all.includes(FINAL)) errs.push("holdout/final.test.ts is missing");
  return errs;
}

export async function g2(art: string, scratch: string): Promise<string[]> {
  const errs: string[] = [];
  const ids = scIds(art);
  if (ids.length === 0) return ["no SC-n.test.ts files were written"];
  for (const id of ids) {
    const mutant = join(art, `mutant.${id}.ts`);
    if (!existsSync(mutant)) {
      errs.push(`mutant.${id}.ts is missing`);
      continue;
    }
    const dir = join(scratch, `g2-${id}`);
    assemble(dir, { ...base(art, mutant), [`${id}.test.ts`]: join(art, `${id}.test.ts`) });
    const r = await runVitest(dir);
    if (r.crashed) errs.push(`${id}.test.ts could not run against mutant.${id}.ts`);
    else if (r.ok) errs.push(`mutant.${id}.ts was not killed by ${id}.test.ts`);
  }
  return errs;
}

export async function g3(
  art: string,
  holdoutDir: string,
  scratch: string,
): Promise<{ errors: string[]; symptoms: string[] }> {
  const impl = join(art, "impl.ts");
  if (!existsSync(impl)) return { errors: ["impl.ts is missing"], symptoms: [] };
  const typeErrs = await typecheck([impl, join(art, "interface.ts")]);
  if (typeErrs.length > 0) return { errors: typeErrs, symptoms: [] };

  const own = join(scratch, "g3-own");
  const tests = Object.fromEntries(scIds(art).map((id) => [`${id}.test.ts`, join(art, `${id}.test.ts`)]));
  assemble(own, { ...base(art, impl), ...tests });
  const r1 = await runVitest(own);
  if (!r1.ok) {
    const errors = r1.crashed
      ? ["the SC tests could not run against impl.ts"]
      : r1.failures.map((f) => `${f.file}: ${f.title}\n${f.message.split("\n")[0]}`);
    return { errors, symptoms: [] };
  }

  const hold = join(scratch, "g3-holdout");
  const files = Object.fromEntries(holdoutFiles(holdoutDir, false).map((f) => [f, join(holdoutDir, f)]));
  assemble(hold, { ...base(art, impl), ...files });
  const r2 = await runVitest(hold);
  if (r2.crashed) return { errors: [], symptoms: ["実装が想定された入出力の形で動かない"] };
  return { errors: [], symptoms: r2.failures.map((f) => f.title) };
}

export async function finalCheck(art: string, holdoutDir: string, scratch: string): Promise<boolean> {
  const dir = join(scratch, "final");
  assemble(dir, { ...base(art, join(art, "impl.ts")), [FINAL]: join(holdoutDir, FINAL) });
  return (await runVitest(dir)).ok;
}

export async function killRate(
  art: string,
  holdoutDir: string,
  scratch: string,
): Promise<{ killed: number; total: number }> {
  const files = Object.fromEntries(holdoutFiles(holdoutDir, true).map((f) => [f, join(holdoutDir, f)]));
  let killed = 0;
  const ids = scIds(art).filter((id) => existsSync(join(art, `mutant.${id}.ts`)));
  for (const id of ids) {
    const dir = join(scratch, `kill-${id}`);
    assemble(dir, { ...base(art, join(art, `mutant.${id}.ts`)), ...files });
    const r = await runVitest(dir);
    if (!r.ok && !r.crashed) killed++;
  }
  return { killed, total: ids.length };
}
