import { ALWAYS_DENIED, runClaude, type ClaudeRun } from '@ot/agent-runtime';
import { FatalNodeError } from './types';

const FATAL = new Set(['auth', 'quota', 'budget', 'nested_session', 'not_installed']);

/** One read-only `claude -p` call in the worktree; throws (fatal or retryable) unless the CLI finished cleanly. */
export async function askClaude(o: {
  bin: string; cwd: string; prompt: string; allowedTools: string[]; timeoutSeconds: number; model?: string; maxBudgetUsd?: number;
  /** Append the CLI's event stream here while it runs (shown as the live log). */
  logFile?: string;
}): Promise<{ text: string; run: ClaudeRun }> {
  const run = await runClaude({
    bin: o.bin,
    cwd: o.cwd,
    stdin: o.prompt,
    teeFile: o.logFile,
    timeoutMs: o.timeoutSeconds * 1000,
    args: [
      '-p', '--output-format', o.logFile ? 'stream-json' : 'json', ...(o.logFile ? ['--verbose'] : []), '--no-session-persistence', '--strict-mcp-config', '--permission-mode', 'default',
      ...(o.model ? ['--model', o.model] : []),
      ...(o.maxBudgetUsd ? ['--max-budget-usd', String(o.maxBudgetUsd)] : []),
      '--allowedTools', ...o.allowedTools,
      '--disallowedTools', ...ALWAYS_DENIED, 'Edit', 'MultiEdit', 'Write', 'NotebookEdit',
    ],
  });
  if (run.signal !== 'ok') {
    const msg = `${run.signal}: ${run.message ?? 'unknown error'}`;
    throw FATAL.has(run.signal) ? new FatalNodeError(msg) : new Error(msg);
  }
  const text = (run.result?.result ?? '').trim();
  if (!text) throw new Error('The AI returned an empty answer');
  return { text, run };
}

/** Read-only AI call with the step's engine: Claude Code (default), Gemini CLI (approval mode "plan") or Antigravity CLI (mode "plan"). */
export async function askAgent(o: {
  engine?: 'claude' | 'gemini' | 'antigravity'; claudeBin: string; geminiBin: string; antigravityBin: string; cwd: string; prompt: string; allowedTools: string[];
  timeoutSeconds: number; model?: string; maxBudgetUsd?: number; logFile?: string;
}): Promise<{ text: string; costUsd: number | null; numTurns: number | null }> {
  if (o.engine === 'gemini') {
    const { runGemini } = await import('./gemini');
    const r = await runGemini({ bin: o.geminiBin, cwd: o.cwd, prompt: o.prompt, timeoutMs: o.timeoutSeconds * 1000, model: o.model });
    if (r.signal !== 'ok' || !r.text) {
      const msg = `gemini ${r.signal}: ${r.message ?? 'empty answer'}`;
      throw ['auth', 'quota', 'not_installed', 'untrusted'].includes(r.signal) ? new FatalNodeError(msg) : new Error(msg);
    }
    return { text: r.text, costUsd: null, numTurns: null };
  }
  if (o.engine === 'antigravity') {
    const { runAntigravity } = await import('./antigravity');
    const r = await runAntigravity({ bin: o.antigravityBin, cwd: o.cwd, prompt: o.prompt, timeoutMs: o.timeoutSeconds * 1000, model: o.model, logFile: o.logFile });
    if (r.signal !== 'ok' || !r.text) {
      const msg = `antigravity ${r.signal}: ${r.message ?? 'empty answer'}`;
      throw ['auth', 'quota', 'not_installed'].includes(r.signal) ? new FatalNodeError(msg) : new Error(msg);
    }
    return { text: r.text, costUsd: null, numTurns: null };
  }
  const { text, run } = await askClaude({ bin: o.claudeBin, cwd: o.cwd, prompt: o.prompt, allowedTools: o.allowedTools, timeoutSeconds: o.timeoutSeconds, model: o.model, maxBudgetUsd: o.maxBudgetUsd, logFile: o.logFile });
  return { text, costUsd: run.result?.total_cost_usd ?? null, numTurns: run.result?.num_turns ?? null };
}
