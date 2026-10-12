import { ALWAYS_DENIED, runClaude, type ClaudeRun } from '@ot/mod-pipeline';
import { FatalNodeError } from './types';

const FATAL = new Set(['auth', 'quota', 'budget', 'nested_session', 'not_installed']);

/** One read-only `claude -p` call in the worktree; throws (fatal or retryable) unless the CLI finished cleanly. */
export async function askClaude(o: {
  bin: string; cwd: string; prompt: string; allowedTools: string[]; timeoutSeconds: number; model?: string; maxBudgetUsd?: number;
}): Promise<{ text: string; run: ClaudeRun }> {
  const run = await runClaude({
    bin: o.bin,
    cwd: o.cwd,
    stdin: o.prompt,
    timeoutMs: o.timeoutSeconds * 1000,
    args: [
      '-p', '--output-format', 'json', '--no-session-persistence', '--strict-mcp-config', '--permission-mode', 'default',
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
