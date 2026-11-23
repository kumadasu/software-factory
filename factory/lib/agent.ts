import { spawn } from "node:child_process";
import { createWriteStream, readFileSync } from "node:fs";

export type AgentRequest = {
  stage: string;
  cwd: string;
  prompt: string;
  maxTurns: number;
  logFile: string;
  denyPaths: string[];
};

/** `fatal` means retrying is pointless (e.g. the usage limit was reached); the run should stop. */
export type AgentResult = { ok: boolean; fatal?: string };
export type Agent = (req: AgentRequest) => Promise<AgentResult>;

/** Detect API-level failures (usage limit, auth, outage) in the JSON result of `claude -p`. */
export function fatalReason(logText: string): string | undefined {
  try {
    const j = JSON.parse(logText) as { is_error?: boolean; terminal_reason?: string; result?: string };
    if (j.is_error && j.terminal_reason === "api_error") return `API error: ${j.result ?? "unknown"}`;
  } catch {
    // Not a JSON result (e.g. the CLI crashed); treat as an ordinary failure.
  }
  return undefined;
}

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
    child.on("close", (code) => {
      log.end(() => {
        const fatal = fatalReason(readFileSync(req.logFile, "utf8"));
        resolvePromise({ ok: code === 0 && !fatal, fatal });
      });
    });
  });
