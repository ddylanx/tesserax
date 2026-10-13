import { execFileSync, spawn } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { cleanEnv, isAlive } from '@ot/mod-pipeline';

/**
 * Antigravity CLI (`agy --print <prompt> --output-format stream-json`, v1.3). One JSON event per stdout line
 * (`init`, `step_update` for every tool call, then a last `result`), after any log lines. The result is:
 *   { "conversation_id": "…", "status": "SUCCESS" | "ERROR" | …, "response": "<final text>", "error"?: "…",
 *     "denied_actions"?: [{ "action": "command", … }], "usage": {…} }
 * (`--output-format json` prints just that object.)
 * Headless mode cannot answer permission prompts: reads/edits inside the workspace are allowed, shell commands are
 * auto-denied (the run still "succeeds", often with an empty response). `--mode plan` is read-only, `accept-edits` lets it edit.
 */
export type AntigravitySignal = 'ok' | 'not_installed' | 'auth' | 'quota' | 'timeout' | 'denied' | 'no_output' | 'error';

export interface AntigravityOutput {
  conversation_id?: string;
  status?: string;
  response?: string;
  error?: string;
  denied_actions?: { action?: string; display_name?: string }[];
}

export function parseAntigravity(stdout: string): AntigravityOutput | null {
  const lines = stdout.trim().split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = lines[i]!.trim();
    if (!l.startsWith('{')) continue;
    try {
      const v = JSON.parse(l) as { event?: string; result?: AntigravityOutput } & AntigravityOutput;
      if (v.event === 'result' && v.result) return v.result;
      if (v.conversation_id && v.status !== undefined) return v;
    } catch {
      /* not a complete JSON line */
    }
  }
  return null;
}

export function antigravitySignal(o: { out: AntigravityOutput | null; stderr: string; exitCode: number | null; timedOut: boolean; spawnError?: string }): { signal: AntigravitySignal; message: string | null } {
  if (o.spawnError) return { signal: 'not_installed', message: o.spawnError };
  const err = `${o.out?.error ?? ''}\n${o.stderr}`;
  if (/authentication required|not (logged|signed) in|sign in|login required/i.test(err)) {
    return { signal: 'auth', message: 'Antigravity CLI is not signed in. Run `agy` in a terminal once and sign in with your Google account.' };
  }
  if (/RESOURCE_EXHAUSTED|quota|rate limit|credits|\b429\b/i.test(err)) return { signal: 'quota', message: err.trim().slice(0, 400) };
  if (o.timedOut) return { signal: 'timeout', message: 'Timed out and was stopped.' };
  if (o.out?.error || (o.out?.status && o.out.status !== 'SUCCESS')) return { signal: 'error', message: (o.out?.error ?? `status ${o.out?.status}`).slice(0, 500) };
  if (!o.out?.response?.trim()) {
    if (o.out?.denied_actions?.length) {
      const what = [...new Set(o.out.denied_actions.map(a => a.action ?? a.display_name ?? 'a tool'))].join(', ');
      return { signal: 'denied', message: `Antigravity was refused ${what} (headless mode cannot ask for permission) and answered nothing. The step is retried; if it keeps failing, choose another engine.` };
    }
    return { signal: 'no_output', message: o.stderr.trim().split('\n').at(-1)?.slice(0, 300) || `No result (exit ${o.exitCode}).` };
  }
  return { signal: 'ok', message: null };
}

/** No stdin prompt in `agy`: the prompt is attached to the flag (a bare value that starts with "-" would be read as a flag). */
export const antigravityArgs = (mode: 'plan' | 'accept-edits', prompt: string, model?: string, addDirs: string[] = []) => [
  '--mode', mode, '--output-format', 'stream-json', ...(model ? ['--model', model] : []), ...addDirs.flatMap(d => ['--add-dir', d]), `--print=${prompt}`,
];

/**
 * A git worktree's `.git` is a pointer into the main repository's `.git/worktrees/…`, outside the working folder, so
 * reading it is refused headless. Plan mode is read-only, so that folder can safely be added to the workspace.
 */
export function gitCommonDir(cwd: string): string | null {
  try {
    const d = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    return d || null;
  } catch {
    return null;
  }
}

/** Shell commands are refused headless and make the model give up silently, so tell it up front. */
export const withToolHint = (prompt: string) =>
  `${prompt}\n\n(Tooling note: this run cannot ask anyone for permission. Shell commands are not available, and you may only read files inside the working folder. Everything you need (the diff, test results, the task) is already in this message: do not inspect .git or search for the branch yourself. If a tool is refused, do not stop: answer from what you have.)`;

/** One headless call, read-only (`--mode plan`). */
export function runAntigravity(o: { bin: string; cwd: string; prompt: string; timeoutMs: number; model?: string; logFile?: string }): Promise<{ text: string | null; signal: AntigravitySignal; message: string | null }> {
  return new Promise(resolve => {
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const git = gitCommonDir(o.cwd);
    const child = spawn(o.bin, antigravityArgs('plan', withToolHint(o.prompt), o.model, git ? [git] : []), { cwd: o.cwd, env: cleanEnv(), stdio: ['ignore', 'pipe', 'pipe'] });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      setTimeout(() => child.exitCode === null && child.kill('SIGKILL'), 2000).unref();
    }, o.timeoutMs);
    let done = false;
    const finish = (code: number | null, spawnError?: string) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      const out = parseAntigravity(stdout);
      const { signal, message } = antigravitySignal({ out, stderr, exitCode: code, timedOut: timedOut && !out?.response, spawnError });
      resolve({ text: out?.response?.trim() || null, signal, message });
    };
    if (o.logFile) mkdirSync(dirname(o.logFile), { recursive: true });
    child.stdout.on('data', d => {
      stdout += d;
      if (o.logFile) appendFileSync(o.logFile, d);
    });
    child.stderr.on('data', d => (stderr += d));
    child.on('error', err => finish(null, (err as NodeJS.ErrnoException).code === 'ENOENT' ? `Antigravity CLI not found: ${o.bin}` : String(err)));
    child.on('close', code => finish(code));
  });
}

/** Detached agent run (`accept-edits`, no shell): prompt kept in runDir, output and exit code written there. */
export function launchAntigravityDetached(o: { bin: string; cwd: string; runDir: string; prompt: string; model?: string }): number {
  mkdirSync(o.runDir, { recursive: true });
  writeFileSync(join(o.runDir, 'prompt.md'), withToolHint(o.prompt), { mode: 0o600 });
  const args = ['--mode', 'accept-edits', '--output-format', 'stream-json', ...(o.model ? ['--model', o.model] : [])];
  writeFileSync(join(o.runDir, 'command.json'), JSON.stringify({ engine: 'antigravity', bin: o.bin, args, cwd: o.cwd, startedAt: new Date().toISOString() }, null, 2));
  const script = '"$OT_BIN" "$@" "--print=$(cat "$OT_RUN_DIR/prompt.md")" > "$OT_RUN_DIR/stdout.json" 2> "$OT_RUN_DIR/stderr.log"; echo $? > "$OT_RUN_DIR/exit_code"';
  const child = spawn('/bin/sh', ['-c', script, 'ot-run', ...args], {
    cwd: o.cwd, detached: true, stdio: 'ignore', env: cleanEnv(process.env, { OT_BIN: o.bin, OT_RUN_DIR: o.runDir }),
  });
  child.unref();
  if (!child.pid) throw new Error('Could not start Antigravity CLI');
  return child.pid;
}

export function readAntigravityOutcome(runDir: string, pid: number | null, timedOut: boolean) {
  const read = (f: string) => (existsSync(join(runDir, f)) ? readFileSync(join(runDir, f), 'utf8') : '');
  const exitFile = existsSync(join(runDir, 'exit_code'));
  const finished = exitFile || !isAlive(pid) || timedOut;
  const exitCode = exitFile ? Number(read('exit_code').trim()) : null;
  const out = parseAntigravity(read('stdout.json'));
  const { signal, message } = antigravitySignal({ out, stderr: read('stderr.log').slice(-20_000), exitCode, timedOut: timedOut && !out?.response });
  return { finished, exitCode, text: out?.response?.trim() || null, signal, message };
}
