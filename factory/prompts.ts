import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export type StageName = "holdout" | "analyze" | "tests";

const dir = join(dirname(fileURLToPath(import.meta.url)), "prompts");

export function buildPrompt(stage: StageName, feedback: string[]): string {
  const body = readFileSync(join(dir, `${stage}.md`), "utf8");
  if (feedback.length === 0) return body;
  return `${body}\n\n## 前回の試行で見つかった問題\n\n${feedback.map((f) => `- ${f}`).join("\n")}\n`;
}
