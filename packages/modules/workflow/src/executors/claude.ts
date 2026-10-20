import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ALWAYS_DENIED, runClaude, type ClaudeRun } from '@tesserax/agent-runtime';
import type { McpGrant } from '@tesserax/contracts';
import { FatalNodeError } from './types';

const FATAL = new Set(['auth', 'quota', 'budget', 'nested_session', 'not_installed']);

/** One read-only `claude -p` call in the worktree; throws (fatal or retryable) unless the CLI finished cleanly. */
export async function askClaude(o: {
  bin: string;
  cwd: string;
  prompt: string;
  allowedTools: string[];
  timeoutSeconds: number;
  model?: string;
  maxBudgetUsd?: number;
  /** Append the CLI's event stream here while it runs (shown as the live log). */
  logFile?: string;
  mcpServers?: { name: string; definition: Record<string, unknown>; tools: string[] | '*' }[];
}): Promise<{ text: string; run: ClaudeRun }> {
  let tmpMcpDir: string | null = null;
  const mcpTools: string[] = [];

  if (o.mcpServers && o.mcpServers.length > 0) {
    tmpMcpDir = mkdtempSync(join(tmpdir(), 'ot-claude-mcp-'));
    const mcpFile = join(tmpMcpDir, 'mcp.json');
    const mcpConfig = {
      mcpServers: Object.fromEntries(o.mcpServers.map(s => [s.name, s.definition])),
    };
    writeFileSync(mcpFile, JSON.stringify(mcpConfig, null, 2), { mode: 0o600 });

    for (const s of o.mcpServers) {
      if (s.tools === '*') {
        mcpTools.push(`mcp__${s.name}__*`);
      } else {
        for (const t of s.tools) {
          mcpTools.push(`mcp__${s.name}__${t}`);
        }
      }
    }
  }

  const mcpArgs = tmpMcpDir
    ? ['--mcp-config', join(tmpMcpDir, 'mcp.json'), '--strict-mcp-config']
    : ['--strict-mcp-config'];

  try {
    const run = await runClaude({
      bin: o.bin,
      cwd: o.cwd,
      stdin: o.prompt,
      teeFile: o.logFile,
      timeoutMs: o.timeoutSeconds * 1000,
      args: [
        '-p', '--output-format', o.logFile ? 'stream-json' : 'json', ...(o.logFile ? ['--verbose'] : []),
        '--no-session-persistence',
        ...mcpArgs,
        '--permission-mode', 'default',
        ...(o.model ? ['--model', o.model] : []),
        ...(o.maxBudgetUsd ? ['--max-budget-usd', String(o.maxBudgetUsd)] : []),
        '--allowedTools', ...o.allowedTools, ...mcpTools,
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
  } finally {
    if (tmpMcpDir && existsSync(tmpMcpDir)) {
      try {
        rmSync(tmpMcpDir, { recursive: true, force: true });
      } catch {
        /* ignore cleanup error */
      }
    }
  }
}

/** Read-only AI call with the step's engine: Claude Code (default), Gemini CLI (approval mode "plan") or Antigravity CLI (mode "plan"). */
export async function askAgent(o: {
  engine?: 'claude' | 'gemini' | 'antigravity';
  claudeBin: string;
  geminiBin: string;
  antigravityBin: string;
  cwd: string;
  prompt: string;
  allowedTools: string[];
  timeoutSeconds: number;
  model?: string;
  maxBudgetUsd?: number;
  logFile?: string;
  mcpGrant?: McpGrant;
}): Promise<{ text: string; costUsd: number | null; numTurns: number | null }> {
  if (o.engine === 'gemini') {
    const { runGemini } = await import('./gemini');
    const allowedMcpServers = (o.mcpGrant?.servers ?? []).map(s => s.name);
    const r = await runGemini({
      bin: o.geminiBin,
      cwd: o.cwd,
      prompt: o.prompt,
      timeoutMs: o.timeoutSeconds * 1000,
      model: o.model,
      allowedMcpServers,
    });
    if (r.signal !== 'ok' || !r.text) {
      const msg = `gemini ${r.signal}: ${r.message ?? 'empty answer'}`;
      throw ['auth', 'quota', 'not_installed', 'untrusted'].includes(r.signal) ? new FatalNodeError(msg) : new Error(msg);
    }
    return { text: r.text, costUsd: null, numTurns: null };
  }
  if (o.engine === 'antigravity') {
    const { runAntigravity } = await import('./antigravity');
    const allowedMcpTools = (o.mcpGrant?.servers ?? []).flatMap(s =>
      s.tools === '*' ? [`${s.name}/*`] : s.tools.map(t => `${s.name}/${t}`),
    );
    const r = await runAntigravity({
      bin: o.antigravityBin,
      cwd: o.cwd,
      prompt: o.prompt,
      timeoutMs: o.timeoutSeconds * 1000,
      model: o.model,
      logFile: o.logFile,
      allowedMcpTools,
    });
    if (r.signal !== 'ok' || !r.text) {
      const msg = `antigravity ${r.signal}: ${r.message ?? 'empty answer'}`;
      throw ['auth', 'quota', 'not_installed'].includes(r.signal) ? new FatalNodeError(msg) : new Error(msg);
    }
    return { text: r.text, costUsd: null, numTurns: null };
  }
  const { text, run } = await askClaude({
    bin: o.claudeBin,
    cwd: o.cwd,
    prompt: o.prompt,
    allowedTools: o.allowedTools,
    timeoutSeconds: o.timeoutSeconds,
    model: o.model,
    maxBudgetUsd: o.maxBudgetUsd,
    logFile: o.logFile,
    mcpServers: o.mcpGrant?.servers,
  });
  return { text, costUsd: run.result?.total_cost_usd ?? null, numTurns: run.result?.num_turns ?? null };
}
