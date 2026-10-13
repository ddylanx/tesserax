import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanEnv, isAlive } from '@ot/mod-pipeline';

/**
 * Gemini CLI (`gemini -p … -o json`). Output on stdout:
 *   { "session_id": "…", "response": "<final text>", "stats": {…} }      on success
 *   { "session_id": "…", "error": { "type": "…", "message": "…" } }      on failure (non-zero exit; 41 = no auth method)
 * Observed with gemini 0.63.0. In a folder Gemini does not trust, it downgrades the approval mode to "default",
 * which in headless mode means edits are refused: the worktree folder must be trusted once in Gemini.
 */
export type GeminiSignal = 'ok' | 'not_installed' | 'auth' | 'quota' | 'untrusted' | 'timeout' | 'no_output' | 'error';

export interface GeminiOutput {
  session_id?: string;
  response?: string;
  error?: { type?: string; message?: string; code?: number | string };
  stats?: unknown;
}

export function parseGemini(stdout: string): GeminiOutput | null {
  const t = stdout.trim();
  if (!t) return null;
  const start = t.indexOf('{');
  if (start < 0) return null;
  try {
    return JSON.parse(t.slice(start)) as GeminiOutput;
  } catch {
    return null;
  }
}

export function geminiSignal(o: { out: GeminiOutput | null; stderr: string; exitCode: number | null; timedOut: boolean; spawnError?: string; needsEdits?: boolean }): { signal: GeminiSignal; message: string | null } {
  if (o.spawnError) return { signal: 'not_installed', message: o.spawnError };
  const err = `${o.out?.error?.message ?? ''}\n${o.stderr}`;
  if (/Auth method|GEMINI_API_KEY|GOOGLE_GENAI_USE|not logged in|login required/i.test(err)) {
    return { signal: 'auth', message: 'Gemini CLI is not signed in. Run `gemini` in a terminal once and choose "Login with Google".' };
  }
  if (/RESOURCE_EXHAUSTED|quota|rate limit|\b429\b/i.test(err)) return { signal: 'quota', message: (o.out?.error?.message ?? err).trim().slice(0, 400) };
  if (o.needsEdits && /not trusted/i.test(o.stderr)) {
    return { signal: 'untrusted', message: 'Gemini does not trust the worktree folder, so it may not edit files. Run `gemini` once inside open-tesseract/.data/worktrees and trust the folder.' };
  }
  if (o.timedOut) return { signal: 'timeout', message: 'Timed out and was stopped.' };
  if (o.out?.error) return { signal: 'error', message: (o.out.error.message ?? 'Gemini error').slice(0, 500) };
  if (!o.out?.response) return { signal: 'no_output', message: o.stderr.trim().split('\n').at(-1)?.slice(0, 300) || `No result (exit ${o.exitCode}).` };
  return { signal: 'ok', message: null };
}

export const geminiArgs = (mode: 'plan' | 'auto_edit', model?: string) => ['-p', '', '-o', 'json', '--approval-mode', mode, ...(model ? ['-m', model] : [])];

/** One headless call, read-only (approval mode "plan"). */
export function runGemini(o: { bin: string; cwd: string; prompt: string; timeoutMs: number; model?: string }): Promise<{ text: string | null; signal: GeminiSignal; message: string | null }> {
  return new Promise(resolve => {
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const child = spawn(o.bin, geminiArgs('plan', o.model), { cwd: o.cwd, env: cleanEnv(), stdio: ['pipe', 'pipe', 'pipe'] });
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
      const out = parseGemini(stdout);
      const { signal, message } = geminiSignal({ out, stderr, exitCode: code, timedOut: timedOut && !out?.response, spawnError });
      resolve({ text: out?.response?.trim() ?? null, signal, message });
    };
    child.stdout.on('data', d => (stdout += d));
    child.stderr.on('data', d => (stderr += d));
    child.on('error', err => finish(null, (err as NodeJS.ErrnoException).code === 'ENOENT' ? `Gemini CLI not found: ${o.bin}` : String(err)));
    child.on('close', code => finish(code));
    child.stdin.on('error', () => undefined);
    child.stdin.end(o.prompt);
  });
}

/** Detached agent run (edits allowed, no shell): prompt from a file, output and exit code into runDir. */
export function launchGeminiDetached(o: { bin: string; cwd: string; runDir: string; prompt: string; model?: string }): number {
  mkdirSync(o.runDir, { recursive: true });
  writeFileSync(join(o.runDir, 'prompt.md'), o.prompt, { mode: 0o600 });
  const args = geminiArgs('auto_edit', o.model);
  writeFileSync(join(o.runDir, 'command.json'), JSON.stringify({ engine: 'gemini', bin: o.bin, args, cwd: o.cwd, startedAt: new Date().toISOString() }, null, 2));
  const script = '"$OT_BIN" "$@" < "$OT_RUN_DIR/prompt.md" > "$OT_RUN_DIR/stdout.json" 2> "$OT_RUN_DIR/stderr.log"; echo $? > "$OT_RUN_DIR/exit_code"';
  const child = spawn('/bin/sh', ['-c', script, 'ot-run', ...args], {
    cwd: o.cwd, detached: true, stdio: 'ignore', env: cleanEnv(process.env, { OT_BIN: o.bin, OT_RUN_DIR: o.runDir }),
  });
  child.unref();
  if (!child.pid) throw new Error('Could not start Gemini CLI');
  return child.pid;
}

export function readGeminiOutcome(runDir: string, pid: number | null, timedOut: boolean) {
  const read = (f: string) => (existsSync(join(runDir, f)) ? readFileSync(join(runDir, f), 'utf8') : '');
  const exitFile = existsSync(join(runDir, 'exit_code'));
  const finished = exitFile || !isAlive(pid) || timedOut;
  const exitCode = exitFile ? Number(read('exit_code').trim()) : null;
  const out = parseGemini(read('stdout.json'));
  const { signal, message } = geminiSignal({ out, stderr: read('stderr.log').slice(-20_000), exitCode, timedOut: timedOut && !out?.response, needsEdits: true });
  return { finished, exitCode, text: out?.response?.trim() ?? null, signal, message };
}

export const engineOf = (runDir: string | null): 'claude' | 'gemini' | 'antigravity' => {
  if (!runDir || !existsSync(join(runDir, 'command.json'))) return 'claude';
  try {
    const engine = (JSON.parse(readFileSync(join(runDir, 'command.json'), 'utf8')) as { engine?: string }).engine;
    return engine === 'gemini' || engine === 'antigravity' ? engine : 'claude';
  } catch {
    return 'claude';
  }
};
