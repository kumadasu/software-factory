import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";

export type AgentRequest = {
  stage: string;
  cwd: string;
  prompt: string;
  maxTurns: number;
  logFile: string;
  denyPaths: string[];
};

export type Agent = (req: AgentRequest) => Promise<{ ok: boolean }>;

const ALLOWED = ["Read", "Write", "Edit", "Glob", "Grep", "Bash(npx vitest:*)", "Bash(npx tsc:*)"];

export function claudeArgs(req: AgentRequest): string[] {
  // Absolute paths in permission rules are written with a leading "//".
  const deny = req.denyPaths.flatMap((p) => [`Read(/${p}/**)`, `Edit(/${p}/**)`]);
  return [
    "-p", req.prompt,
    "--max-turns", String(req.maxTurns),
    "--output-format", "json",
    "--permission-mode", "acceptEdits",
    "--allowedTools", ALLOWED.join(","),
    "--settings", JSON.stringify({ permissions: { deny } }),
  ];
}

/** Run one headless Claude Code session in req.cwd and write its JSON result to req.logFile. */
export const claudeAgent: Agent = (req) =>
  new Promise((resolvePromise) => {
    const log = createWriteStream(req.logFile);
    const child = spawn("claude", claudeArgs(req), { cwd: req.cwd, stdio: ["ignore", "pipe", "pipe"] });
    child.stdout.pipe(log);
    child.stderr.pipe(log);
    child.on("close", (code) => resolvePromise({ ok: code === 0 }));
  });
