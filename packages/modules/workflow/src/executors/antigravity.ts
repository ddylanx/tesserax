import { execFileSync, spawn } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { cleanEnv, isAlive } from '@tesserax/agent-runtime';

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
      return { signal: 'denied', message: `Antigravity was refused ${what} (headless mode cannot ask for permission) and stopped with no answer. Retry the step, or pick another agent for it on the run page.` };
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

/** Shell commands Antigravity may run headless: the `command(<prefix>)` rules under permissions.allow in its settings. */
export function allowedCommands(settingsFile = join(homedir(), '.gemini', 'antigravity-cli', 'settings.json')): string[] {
  try {
    const allow = (JSON.parse(readFileSync(settingsFile, 'utf8')) as { permissions?: { allow?: unknown[] } }).permissions?.allow ?? [];
    return allow.flatMap(r => (typeof r === 'string' ? [/^command\((.+)\)$/.exec(r.trim())?.[1]] : [])).filter((c): c is string => !!c);
  } catch {
    return [];
  }
}

/**
 * Any shell command outside the allow rules is refused headless, and Antigravity then ends the whole run with no answer
 * and no edits (seen with `sed -n`), so tell the model up front exactly what it may run.
 */
export const withToolHint = (prompt: string, mode: 'plan' | 'accept-edits' = 'plan', allowed: string[] = allowedCommands()) => {
  const shell = allowed.length
    ? `The only shell commands allowed are: ${allowed.map(c => `\`${c}\``).join(', ')}. Any other command (for example sed, find, awk, npm, php, composer) is refused and ends this run with nothing, so never try one: read files and line ranges with the file viewer and search with grep / git grep.`
    : 'Shell commands are not available.';
  const files = mode === 'plan'
    ? 'You may only read files inside the working folder.'
    : 'Read and edit files inside the working folder with your file tools (not the shell).';
  return `${prompt}\n\n(Tooling note: this run cannot ask anyone for permission. ${files} ${shell} Everything you need (the diff, test results, the task) is already in this message: do not inspect .git or search for the branch yourself. If a tool is refused anyway, do not stop: answer from what you have.)`;
};

/**
 * One refused tool (e.g. read_file on a path outside the workspace) ends agy's whole turn with an empty answer, even when
 * the prompt says to carry on. Continuing the same conversation (`--conversation <id>`) with a short note lets it finish
 * without that tool, so a denied turn is continued up to this many times before the step fails.
 */
export const DENIED_RETRIES = 2;
export const DENIED_FOLLOW_UP =
  'The tool you just tried was refused: this run cannot ask anyone for permission, and only the working folder is readable. Do not try it again or work around it. Carry on with the rest of the task without it and finish with your answer. In that answer add a short section `## Not read` listing each refused file or command and what you assumed instead (keep any required last line, such as the VERDICT line, last).';

/** What agy was refused, from the tool errors in its event stream, e.g. `read_file /repo/.git/config`. */
export function blockedActions(stdout: string): string[] {
  const found = new Set<string>();
  for (const m of stdout.matchAll(/permission check failed for ([a-z_]+) \\?"((?:[^"\\]|\\.)*?)\\?"/g)) found.add(`${m[1]} ${m[2]}`);
  return [...found];
}

/** Shown at the top of the step's artifact so the gate sees what the agent worked without. */
export const blockedNote = (blocked: string[]) =>
  blocked.length ? `> **Antigravity was refused (it went on without them):** ${blocked.map(b => `\`${b}\``).join(', ')}. Check the "Not read" section for what it assumed.\n\n` : '';

/** The conversation to continue when the turn ended only because a tool was refused (no answer). */
export function deniedConversation(out: AntigravityOutput | null): string | null {
  return out?.conversation_id && !out.response?.trim() && out.denied_actions?.length ? out.conversation_id : null;
}

/** One headless call, read-only (`--mode plan`); a turn stopped by a refused tool is continued (DENIED_RETRIES). */
export async function runAntigravity(o: { bin: string; cwd: string; prompt: string; timeoutMs: number; model?: string; logFile?: string }): Promise<{ text: string | null; signal: AntigravitySignal; message: string | null; blocked: string[] }> {
  const git = gitCommonDir(o.cwd);
  const deadline = Date.now() + o.timeoutMs;
  if (o.logFile) mkdirSync(dirname(o.logFile), { recursive: true });
  let args = antigravityArgs('plan', withToolHint(o.prompt), o.model, git ? [git] : []);
  const blocked = new Set<string>();
  for (let attempt = 0; ; attempt++) {
    const r = await runAntigravityOnce({ ...o, args, timeoutMs: Math.max(1000, deadline - Date.now()) });
    for (const b of blockedActions(r.stdout)) blocked.add(b);
    const conversation = attempt < DENIED_RETRIES && r.signal === 'denied' ? deniedConversation(r.out) : null;
    if (!conversation) {
      const text = r.out?.response?.trim() || null;
      return { text: text && blockedNote([...blocked]) + text, signal: r.signal, message: r.message, blocked: [...blocked] };
    }
    args = [...antigravityArgs('plan', DENIED_FOLLOW_UP, o.model, git ? [git] : []).slice(0, -1), '--conversation', conversation, `--print=${DENIED_FOLLOW_UP}`];
  }
}

function runAntigravityOnce(o: { bin: string; cwd: string; args: string[]; timeoutMs: number; logFile?: string }): Promise<{ out: AntigravityOutput | null; stdout: string; signal: AntigravitySignal; message: string | null }> {
  return new Promise(resolve => {
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const child = spawn(o.bin, o.args, { cwd: o.cwd, env: cleanEnv(), stdio: ['ignore', 'pipe', 'pipe'] });
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
      resolve({ out, stdout, ...antigravitySignal({ out, stderr, exitCode: code, timedOut: timedOut && !out?.response, spawnError }) });
    };
    child.stdout.on('data', d => {
      stdout += d;
      if (o.logFile) appendFileSync(o.logFile, d);
    });
    child.stderr.on('data', d => (stderr += d));
    child.on('error', err => finish(null, (err as NodeJS.ErrnoException).code === 'ENOENT' ? `Antigravity CLI not found: ${o.bin}` : String(err)));
    child.on('close', code => finish(code));
  });
}

/**
 * Runs inside the detached process (plain Node, no TS): calls agy, continues the conversation when a refused tool ended
 * the turn with no answer (same rule as deniedConversation), appends every turn to stdout.json, then writes exit_code.
 */
const DETACHED_RUNNER = `
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const e = process.env, dir = e.TESSERAX_RUN_DIR, args = JSON.parse(e.TESSERAX_ARGS);
const file = n => dir + '/' + n;
const out = fs.openSync(file('stdout.json'), 'a'), err = fs.openSync(file('stderr.log'), 'a');
let prompt = fs.readFileSync(file('prompt.md'), 'utf8'), extra = [], code = 1;
for (let i = 0; ; i++) {
  const r = spawnSync(e.TESSERAX_BIN, [...args, ...extra, '--print=' + prompt], { stdio: ['ignore', out, err] });
  code = r.status ?? 1;
  if (i >= Number(e.TESSERAX_DENIED_RETRIES)) break;
  const last = fs.readFileSync(file('stdout.json'), 'utf8').trim().split('\\n').reverse().find(l => l.startsWith('{"event":"result"'));
  let res = null;
  try { res = JSON.parse(last).result; } catch {}
  if (!res || !res.conversation_id || (res.response || '').trim() || !(res.denied_actions || []).length) break;
  extra = ['--conversation', res.conversation_id];
  prompt = e.TESSERAX_FOLLOW_UP;
}
fs.writeFileSync(file('exit_code'), String(code) + '\\n');
`;

/** Detached agent run (`accept-edits`, no shell): prompt kept in runDir, output and exit code written there. */
export function launchAntigravityDetached(o: { bin: string; cwd: string; runDir: string; prompt: string; model?: string }): number {
  mkdirSync(o.runDir, { recursive: true });
  writeFileSync(join(o.runDir, 'prompt.md'), withToolHint(o.prompt, 'accept-edits'), { mode: 0o600 });
  const git = gitCommonDir(o.cwd);
  const args = [
    '--mode', 'accept-edits',
    '--output-format', 'stream-json',
    ...(o.model ? ['--model', o.model] : []),
    ...(git ? ['--add-dir', git] : []),
  ];
  writeFileSync(join(o.runDir, 'command.json'), JSON.stringify({ engine: 'antigravity', bin: o.bin, args, cwd: o.cwd, deniedRetries: DENIED_RETRIES, startedAt: new Date().toISOString() }, null, 2));
  const child = spawn(process.execPath, ['-e', DETACHED_RUNNER], {
    cwd: o.cwd, detached: true, stdio: 'ignore',
    env: cleanEnv(process.env, {
      TESSERAX_BIN: o.bin, TESSERAX_RUN_DIR: o.runDir, TESSERAX_ARGS: JSON.stringify(args),
      TESSERAX_DENIED_RETRIES: String(DENIED_RETRIES), TESSERAX_FOLLOW_UP: DENIED_FOLLOW_UP,
    }),
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
  const stdout = read('stdout.json');
  const out = parseAntigravity(stdout);
  const { signal, message } = antigravitySignal({ out, stderr: read('stderr.log').slice(-20_000), exitCode, timedOut: timedOut && !out?.response });
  const blocked = blockedActions(stdout);
  const text = out?.response?.trim() || null;
  return { finished, exitCode, text: text && blockedNote(blocked) + text, signal, message: message && blocked.length ? `${message} Refused: ${blocked.join(', ')}.` : message, blocked };
}
