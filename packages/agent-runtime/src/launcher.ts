import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanEnv, detectSignal, parseResult, type AgentSignal, type ClaudeResult } from './claude-cli';

/** Never allowed in a playbook run, whatever the playbook says. */
export const ALWAYS_DENIED = [
  'Bash(git push:*)', 'Bash(git merge:*)', 'Bash(git rebase:*)', 'Bash(git remote:*)', 'Bash(git reset --hard:*)',
  'Bash(git checkout:*)', 'Bash(git switch:*)', 'Bash(git worktree:*)', 'Bash(git branch -D:*)', 'Bash(gh:*)',
  'Bash(rm -rf:*)', 'Bash(curl:*)', 'Bash(wget:*)',
];

export interface LaunchOptions {
  bin: string;
  cwd: string;
  runDir: string;
  prompt: string;
  sessionId: string;
  permissionMode: string;
  allowedTools: string[];
  maxBudgetUsd?: number;
  model?: string;
  env?: Record<string, string>;
  /** stream-json (one event per line, so the run can be followed live) instead of a single json result. */
  stream?: boolean;
}

export function buildRunArgs(o: Omit<LaunchOptions, 'bin' | 'cwd' | 'runDir' | 'prompt' | 'env'>): string[] {
  return [
    '-p', '--output-format', o.stream ? 'stream-json' : 'json', ...(o.stream ? ['--verbose'] : []),
    '--session-id', o.sessionId,
    '--permission-mode', o.permissionMode,
    '--strict-mcp-config',
    ...(o.maxBudgetUsd ? ['--max-budget-usd', String(o.maxBudgetUsd)] : []),
    ...(o.model ? ['--model', o.model] : []),
    '--allowedTools', ...o.allowedTools,
    '--disallowedTools', ...ALWAYS_DENIED,
  ];
}

/**
 * Starts `claude -p` detached so it outlives this job (and an API restart). The prompt is read from a file
 * (never on the command line); stdout, stderr and the exit code land in runDir, where finalize() reads them.
 */
export function launchDetached(o: LaunchOptions): number {
  mkdirSync(o.runDir, { recursive: true });
  writeFileSync(join(o.runDir, 'prompt.md'), o.prompt, { mode: 0o600 });
  const args = buildRunArgs(o);
  writeFileSync(join(o.runDir, 'command.json'), JSON.stringify({ bin: o.bin, args, cwd: o.cwd, startedAt: new Date().toISOString() }, null, 2));
  const script = '"$TESSERAX_BIN" "$@" < "$TESSERAX_RUN_DIR/prompt.md" > "$TESSERAX_RUN_DIR/stdout.json" 2> "$TESSERAX_RUN_DIR/stderr.log"; echo $? > "$TESSERAX_RUN_DIR/exit_code"';
  const child = spawn('/bin/sh', ['-c', script, 'ot-run', ...args], {
    cwd: o.cwd,
    detached: true, // own process group, so cancel/timeout can stop the whole tree
    stdio: 'ignore',
    env: cleanEnv(process.env, { ...o.env, TESSERAX_BIN: o.bin, TESSERAX_RUN_DIR: o.runDir }),
  });
  child.unref();
  if (!child.pid) throw new Error('Could not start the agent process');
  return child.pid;
}

export const isAlive = (pid: number | null | undefined) => {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

/** Stops the run's process group (SIGTERM, then SIGKILL). */
export function stopProcess(pid: number | null | undefined) {
  if (!pid) return;
  try {
    process.kill(-pid, 'SIGTERM');
  } catch {
    /* already gone */
  }
  setTimeout(() => {
    try {
      process.kill(-pid, 'SIGKILL');
    } catch {
      /* gone */
    }
  }, 3000).unref();
}

export interface RunOutcome {
  finished: boolean;
  exitCode: number | null;
  result: ClaudeResult | null;
  signal: AgentSignal;
  message: string | null;
}

/** Reads a run directory. finished=false while the process is still going. */
export function readOutcome(runDir: string, pid: number | null, timedOut: boolean): RunOutcome {
  const exitFile = join(runDir, 'exit_code');
  const finished = existsSync(exitFile) || !isAlive(pid) || timedOut;
  const read = (f: string) => (existsSync(join(runDir, f)) ? readFileSync(join(runDir, f), 'utf8') : '');
  const exitCode = existsSync(exitFile) ? Number(read('exit_code').trim()) : null;
  const result = parseResult(read('stdout.json'));
  const stderr = read('stderr.log').slice(-20_000);
  const { signal, message } = detectSignal({ exitCode, timedOut: timedOut && !result, stderr, result });
  return { finished, exitCode, result, signal, message: message ?? (finished && exitCode === null && !result ? 'The agent process ended without a result.' : null) };
}
