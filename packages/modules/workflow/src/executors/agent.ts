import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { dataDir } from '@ot/config';
import { AGENT_EXECUTORS, AGENT_EXECUTOR_INFO, type AgentExecutor } from '@ot/contracts';
import { launchDetached } from '@ot/mod-pipeline';
import { launchAntigravityDetached } from './antigravity';
import { launchGeminiDetached } from './gemini';
import type { NodeContext } from './types';

/** macOS app names for the editors. */
const EDITOR_APPS: Record<string, string> = {
  'editor:antigravity': 'Antigravity',
  'editor:antigravity-ide': 'Antigravity IDE',
  'editor:cursor': 'Cursor',
  'editor:vscode': 'Visual Studio Code',
};

const onPath = (bin: string) => (process.env.PATH ?? '').split(':').some(d => existsSync(join(d, bin)));

/** Which executors this machine can use right now (installed apps / CLIs; login is checked when they run). */
export function availableExecutors(claudeBin: string, geminiBin: string, antigravityBin: string) {
  return AGENT_EXECUTORS.map(id => {
    const info = AGENT_EXECUTOR_INFO[id];
    const available =
      id === 'claude-cli' ? existsSync(claudeBin) || onPath(claudeBin)
      : id === 'gemini-cli' ? existsSync(geminiBin) || onPath(geminiBin)
      : id === 'antigravity-cli' ? existsSync(antigravityBin) || onPath(antigravityBin)
      : existsSync(`/Applications/${EDITOR_APPS[id]}.app`) || existsSync(join(process.env.HOME ?? '', 'Applications', `${EDITOR_APPS[id]}.app`));
    return { id, ...info, available };
  });
}

/** Opens a folder in a macOS app (the app the user picked). */
export function openInEditor(executor: AgentExecutor, folder: string): Promise<void> {
  const app = EDITOR_APPS[executor];
  if (!app) return Promise.reject(new Error(`${executor} is not an editor`));
  return new Promise((resolve, reject) => {
    // OT_OPEN_CMD lets tests replace macOS `open` (so no real window appears)
    const child = spawn(process.env.OT_OPEN_CMD || 'open', ['-a', app, folder], { stdio: 'ignore' });
    child.on('error', reject);
    child.on('close', code => (code === 0 ? resolve() : reject(new Error(`Could not open ${app} (is it installed?)`))));
  });
}

/**
 * Starts the implement step with the chosen executor.
 *  - CLI agents run detached; the watcher finalizes them (status stays "running").
 *  - Editors: the worktree is opened in the app and the node waits for you (Done / Couldn't finish).
 */
export async function startAgent(
  ctx: NodeContext,
  executor: AgentExecutor,
  prepared: { worktree: string; prompt: string; skillHash: string | null },
): Promise<{ mode: 'running' } | { mode: 'handoff'; output: Record<string, unknown> }> {
  const c = ctx.config;
  const runDir = join(dataDir(ctx.appConfig), 'runs', ctx.run.id, ctx.nodeRun.id);
  const model = c.model ?? ctx.appConfig.PLAYBOOK_MODEL;
  if (executor === 'claude-cli' || executor === 'gemini-cli' || executor === 'antigravity-cli') {
    const sessionId = executor === 'claude-cli' ? randomUUID() : null;
    const pid = executor === 'claude-cli'
      ? launchDetached({
          bin: ctx.appConfig.CLAUDE_BIN, cwd: prepared.worktree, runDir, prompt: prepared.prompt, sessionId: sessionId!,
          permissionMode: c.permissionMode, allowedTools: c.allowedTools, maxBudgetUsd: c.maxBudgetUsd, model,
        })
      : executor === 'gemini-cli'
        ? launchGeminiDetached({ bin: ctx.appConfig.GEMINI_BIN, cwd: prepared.worktree, runDir, prompt: prepared.prompt, model: c.model })
        : launchAntigravityDetached({ bin: ctx.appConfig.ANTIGRAVITY_BIN, cwd: prepared.worktree, runDir, prompt: prepared.prompt, model: c.model });
    await ctx.engine.patchNode(ctx.nodeRun.id, { process_id: pid, run_dir: runDir, agent_session_id: sessionId, skill_hash: prepared.skillHash });
    await ctx.engine.event(ctx.run.id, 'job', 'agent_started', { executor, pid, sessionId, worktree: prepared.worktree }, ctx.nodeRun.id);
    return { mode: 'running' };
  }
  await openInEditor(executor, prepared.worktree);
  await ctx.engine.patchNode(ctx.nodeRun.id, { run_dir: runDir, skill_hash: prepared.skillHash });
  await ctx.engine.event(ctx.run.id, 'job', 'handed_off', { executor, worktree: prepared.worktree }, ctx.nodeRun.id);
  return { mode: 'handoff', output: { handoff: executor, worktree: prepared.worktree, branch: ctx.run.branch, prompt: prepared.prompt } };
}
