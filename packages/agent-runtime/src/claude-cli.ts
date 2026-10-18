import { spawn } from 'node:child_process';
import { rawEnvSchema } from '@tesserax/config';
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * Variables a parent Claude Code session injects. Passed on, they make the CLI refuse to start
 * ("cannot be launched inside another Claude Code session") or authenticate against the parent's endpoint.
 */
const PARENT_SESSION_ENV = /^(CLAUDECODE$|CLAUDE_CODE_|CLAUDE_AGENT_SDK_|CLAUDE_PID$|CLAUDE_EFFORT$|CLAUDE_PREVIEW_|ANTHROPIC_BASE_URL$)/;

/**
 * Tesserax's own settings (<repo>/.env is loaded into process.env). A child process works in someone else's
 * repo: it must not inherit our database URL or tokens (a Laravel test run connected to our Postgres through
 * DATABASE_URL). Generic names (NODE_ENV, LOG_LEVEL) are kept.
 */
const OWN_ENV = new Set(Object.keys(rawEnvSchema.shape).filter(k => k !== 'NODE_ENV' && k !== 'LOG_LEVEL'));

/**
 * Ambient host credentials and secrets that must not leak to child processes (agents, tests, scripts)
 * unless explicitly injected via `extra`.
 */
const AMBIENT_SECRETS_PREFIX = /^(AWS_|AZURE_|GCP_|GOOGLE_APPLICATION_CREDENTIALS|GITHUB_|GH_|GITLAB_|NPM_|PYPI_|DOCKER_|VAULT_|KUBECONFIG|HEROKU_|STRIPE_|SENTRY_|SSH_AUTH_SOCK|SSH_AGENT_PID|GPG_AGENT_INFO)/i;
const SENSITIVE_KEY_SUFFIX = /(_TOKEN|_SECRET|_PASSWORD|_PRIVATE_KEY)$/i;

/** Known AI engine API keys that agent CLI child processes legitimately need from the host environment. */
const ALLOWED_AI_KEYS = new Set(['ANTHROPIC_API_KEY', 'GEMINI_API_KEY', 'OPENAI_API_KEY']);

export function isSecretEnvKey(k: string): boolean {
  if (ALLOWED_AI_KEYS.has(k)) return false;
  return OWN_ENV.has(k) || AMBIENT_SECRETS_PREFIX.test(k) || SENSITIVE_KEY_SUFFIX.test(k);
}

export function cleanEnv(env: NodeJS.ProcessEnv = process.env, extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(env)) {
    if (!PARENT_SESSION_ENV.test(k) && !isSecretEnvKey(k)) {
      out[k] = v;
    }
  }
  return { ...out, ...extra };
}

/** The `--output-format json` result object (fields we use). */
export interface ClaudeResult {
  type: 'result';
  subtype?: string;
  is_error?: boolean;
  result?: string;
  session_id?: string;
  total_cost_usd?: number;
  duration_ms?: number;
  num_turns?: number;
  structured_output?: unknown;
}

export type AgentSignal = 'ok' | 'not_installed' | 'nested_session' | 'auth' | 'quota' | 'overloaded' | 'budget' | 'max_turns' | 'timeout' | 'no_output' | 'error';

export interface ClaudeRun {
  exitCode: number | null;
  timedOut: boolean;
  stdout: string;
  stderr: string;
  result: ClaudeResult | null;
  signal: AgentSignal;
  /** Human-readable reason when signal is not ok. */
  message: string | null;
}

/** Last complete JSON object with type "result" in the output (json or stream-json). */
export function parseResult(stdout: string): ClaudeResult | null {
  const text = stdout.trim();
  if (!text) return null;
  const candidates = [text, ...text.split('\n').reverse()];
  for (const c of candidates) {
    try {
      const v = JSON.parse(c);
      if (v && v.type === 'result') return v as ClaudeResult;
    } catch {
      /* not JSON */
    }
  }
  return null;
}

/** Classifies what the CLI told us. Documented in docs/adr/0003-agent-cli-signals.md. */
export function detectSignal(run: Pick<ClaudeRun, 'exitCode' | 'timedOut' | 'stderr' | 'result'> & { spawnError?: string }): { signal: AgentSignal; message: string | null } {
  if (run.spawnError) return { signal: 'not_installed', message: run.spawnError };
  const text = `${run.result?.result ?? ''}\n${run.stderr}`;
  if (/cannot be launched inside another Claude Code session/i.test(text)) return { signal: 'nested_session', message: 'The CLI refused to start inside another Claude Code session (CLAUDECODE set).' };
  if (/Failed to authenticate|authentication_error|OAuth access token|Invalid API key|Please run \/login|not logged in/i.test(text)) {
    return { signal: 'auth', message: 'Claude Code is not logged in (or the login expired). Run `claude` in a terminal and use /login.' };
  }
  if (/usage limit|limit reached|limit will reset|resets? (at|in) |rate_limit_error|\b429\b/i.test(text)) return { signal: 'quota', message: firstLine(text) };
  if (/overloaded_error|\b529\b|Overloaded/i.test(text)) return { signal: 'overloaded', message: firstLine(text) };
  if (run.result?.subtype === 'error_max_budget_usd' || /max(imum)? budget/i.test(text)) return { signal: 'budget', message: 'Stopped at the agent budget (--max-budget-usd).' };
  if (run.result?.subtype === 'error_max_turns') return { signal: 'max_turns', message: 'Stopped at the turn limit.' };
  if (run.timedOut) return { signal: 'timeout', message: 'Timed out and was stopped.' };
  if (!run.result) return { signal: 'no_output', message: firstLine(run.stderr) || `No result (exit ${run.exitCode}).` };
  if (run.result.is_error || (run.exitCode !== 0 && run.exitCode !== null)) return { signal: 'error', message: firstLine(run.result.result ?? run.stderr) || `Exit ${run.exitCode}` };
  return { signal: 'ok', message: null };
}

const firstLine = (s: string) => s.split('\n').map(l => l.trim()).find(Boolean)?.slice(0, 500) ?? '';

export interface RunClaudeOptions {
  bin: string;
  args: string[];
  cwd: string;
  stdin: string;
  timeoutMs: number;
  env?: Record<string, string>;
  /** Append stdout to this file as it arrives (live log). */
  teeFile?: string;
}

/**
 * Runs `claude -p` and waits for its result. Some CLI versions print the result and then do not exit,
 * so once a result object is on stdout the process gets 3 s before it is stopped.
 */
export function runClaude(o: RunClaudeOptions): Promise<ClaudeRun> {
  return new Promise(resolve => {
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let settled = false;
    let graceTimer: NodeJS.Timeout | undefined;
    const child = spawn(o.bin, o.args, { cwd: o.cwd, env: cleanEnv(process.env, o.env), stdio: ['pipe', 'pipe', 'pipe'] });
    const stop = () => {
      if (child.exitCode === null) {
        child.kill('SIGTERM');
        setTimeout(() => child.exitCode === null && child.kill('SIGKILL'), 2000).unref();
      }
    };
    const timer = setTimeout(() => {
      timedOut = true;
      stop();
    }, o.timeoutMs);
    const finish = (exitCode: number | null, spawnError?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(graceTimer);
      const result = parseResult(stdout);
      // a result that arrived before we stopped a lingering process is not a timeout
      const tOut = timedOut && !result;
      const { signal, message } = detectSignal({ exitCode, timedOut: tOut, stderr, result, spawnError });
      resolve({ exitCode, timedOut: tOut, stdout, stderr, result, signal, message });
    };
    if (o.teeFile) mkdirSync(dirname(o.teeFile), { recursive: true });
    child.stdout.on('data', d => {
      stdout += d;
      if (o.teeFile) appendFileSync(o.teeFile, d);
      // stream-json prints many lines: only look for the result once a chunk can contain it
      if (!graceTimer && String(d).includes('"result"') && parseResult(stdout)) graceTimer = setTimeout(stop, 3000);
    });
    child.stderr.on('data', d => (stderr += d));
    child.on('error', err => finish(null, (err as NodeJS.ErrnoException).code === 'ENOENT' ? `Claude CLI not found: ${o.bin}` : String(err)));
    child.on('close', code => finish(code));
    child.stdin.on('error', () => undefined);
    child.stdin.end(o.stdin);
  });
}
