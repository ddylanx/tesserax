import { spawn } from 'node:child_process';
import { join } from 'node:path';
import type { AgentExecutor, NodeType } from '@tesserax/contracts';
import { cleanEnv, diffInfo, diffPatch, git } from '@tesserax/agent-runtime';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, normalize, relative } from 'node:path';
import { buildShellEnv, renderShellTemplate, renderTemplate, withSkills } from '../render';
import { askAgent } from './claude';
import { liveLogFile } from './livelog';
import { startAgent } from './agent';
import { ensureReviewWorktree } from '../review';
import { getProjectInfo } from '../worktree-links';
import { FatalNodeError, type NodeContext, type NodeExecutor, type NodeResult } from './types';

async function renderCtx(ctx: NodeContext, extra: { worktree?: string; repoPath?: string; baseRef?: string; branch?: string; diff?: string } = {}) {
  return {
    task: ctx.task, artifacts: ctx.artifacts, feedback: ctx.feedback,
    branch: extra.branch ?? ctx.run.branch, baseRef: extra.baseRef ?? ctx.run.base_ref, worktreePath: extra.worktree ?? ctx.run.worktree_path,
    repoPath: extra.repoPath ?? ctx.run.repo_path, diff: extra.diff, projectVars: ctx.projectVars,
  };
}

const worktree = async (ctx: NodeContext) => {
  // code-review tasks work in a read-only checkout of the member's branch, compared with its target branch
  if (ctx.task.review) return ensureReviewWorktree(ctx.engine, ctx.appConfig, ctx.run, ctx.task);
  try {
    return await ctx.engine.ensureRunWorktree(ctx.run.id);
  } catch (e) {
    if (e instanceof FatalNodeError) throw e;
    throw new FatalNodeError((e as Error).message);
  }
};

const triggerJira: NodeExecutor = async ctx => {
  await ctx.tasks.ensureDetail(ctx.task.id).catch(() => undefined);
  return { port: 'next', output: { key: ctx.task.key, title: ctx.task.title } };
};

const aiStep: NodeExecutor = async ctx => {
  const c = ctx.config;
  const wt = await worktree(ctx);
  const skill = c.skill ? ctx.skills.get(c.skill) : null;
  const prompt = withSkills(renderTemplate(c.prompt, await renderCtx(ctx, wt)), skill ? [skill] : []);
  const mcpGrant = ctx.mcp
    ? await ctx.mcp.grantFor({ engine: c.engine ?? 'claude', node: ctx.node.config, projectDirs: [wt.worktree] })
    : undefined;
  const { text, costUsd, numTurns } = await askAgent({
    engine: c.engine, claudeBin: ctx.appConfig.CLAUDE_BIN, geminiBin: ctx.appConfig.GEMINI_BIN, antigravityBin: ctx.appConfig.ANTIGRAVITY_BIN, cwd: wt.worktree, prompt, allowedTools: c.allowedTools,
    timeoutSeconds: c.timeoutSeconds, model: c.model ?? (c.engine === 'claude' ? ctx.appConfig.PLAYBOOK_MODEL : undefined), maxBudgetUsd: c.maxBudgetUsd, logFile: liveLogFile(ctx),
    mcpGrant,
  });
  return {
    port: 'next', artifact: { name: c.output, content: text }, output: { chars: text.length },
    costUsd, numTurns, skillHash: skill?.hash ?? null,
  };
};

const aiReview: NodeExecutor = async ctx => {
  const c = ctx.config;
  const wt = await worktree(ctx);
  const info = await diffInfo(wt.worktree, wt.baseRef);
  const { patch, truncated } = await diffPatch(wt.worktree, info.base, 150_000);
  const skills = (c.skills as string[]).map(p => ctx.skills.get(p));
  const prompt = withSkills(
    `${renderTemplate(c.prompt, await renderCtx(ctx, { ...wt, diff: patch + (truncated ? '\n… (diff truncated)' : '') }))}\n\nEnd your answer with exactly one line: VERDICT: PASS or VERDICT: FAIL`,
    skills,
  );
  const mcpGrant = ctx.mcp
    ? await ctx.mcp.grantFor({ engine: c.engine ?? 'claude', node: ctx.node.config, projectDirs: [wt.worktree] })
    : undefined;
  const { text, costUsd, numTurns } = await askAgent({
    engine: c.engine, claudeBin: ctx.appConfig.CLAUDE_BIN, geminiBin: ctx.appConfig.GEMINI_BIN, antigravityBin: ctx.appConfig.ANTIGRAVITY_BIN, cwd: wt.worktree, prompt, allowedTools: c.allowedTools,
    timeoutSeconds: c.timeoutSeconds, model: c.model ?? (c.engine === 'claude' ? ctx.appConfig.PLAYBOOK_MODEL : undefined), maxBudgetUsd: c.maxBudgetUsd, logFile: liveLogFile(ctx),
    mcpGrant,
  });
  const verdict = [...text.matchAll(/VERDICT:\s*(PASS|FAIL)/gi)].at(-1)?.[1]?.toUpperCase();
  if (!verdict) throw new Error('The review did not end with VERDICT: PASS or VERDICT: FAIL');
  return {
    port: verdict === 'PASS' ? 'pass' : 'fail', artifact: { name: c.output, content: text },
    output: { verdict, filesChanged: info.files }, costUsd, numTurns,
    skillHash: skills.map(s => s.hash).join(',') || null,
  };
};

function sh(cmd: string, cwd: string, timeoutMs: number, extraEnv: Record<string, string> = {}): Promise<{ code: number | null; out: string; ms: number; timedOut: boolean }> {
  return new Promise(resolve => {
    const started = Date.now();
    let out = '';
    let timedOut = false;
    const child = spawn('/bin/sh', ['-c', cmd], { cwd, env: cleanEnv(process.env, extraEnv), detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const keep = (d: Buffer) => {
      out = (out + d.toString()).slice(-200_000);
    };
    child.stdout.on('data', keep);
    child.stderr.on('data', keep);
    const t = setTimeout(() => {
      timedOut = true;
      try {
        process.kill(-child.pid!, 'SIGKILL');
      } catch {
        /* gone */
      }
    }, timeoutMs);
    child.on('error', err => keep(Buffer.from(String(err))));
    child.on('close', code => {
      clearTimeout(t);
      resolve({ code, out, ms: Date.now() - started, timedOut });
    });
  });
}

const checkCommand: NodeExecutor = async ctx => {
  const c = ctx.config;
  const wt = await worktree(ctx);
  const rc = await renderCtx(ctx, wt);
  for (const raw of ((c.commands ?? []) as string[])) {
    if (raw.includes('project.test_command') || raw.includes('TX_PROJECT_TEST_COMMAND')) {
      const testCmd = rc.projectVars?.test_command?.trim();
      if (!testCmd) {
        const projectName = getProjectInfo(ctx.run.vars).name || ctx.task.project || 'unnamed';
        throw new FatalNodeError(`Project ${projectName} has no test_command; set it on the project page`);
      }
    }
  }
  const shellEnv = buildShellEnv(rc);
  const lines: string[] = [`# Checks in ${wt.worktree}`, ''];
  const results: { command: string; exitCode: number | null; seconds: number }[] = [];
  let ok = true;
  const deadline = Date.now() + c.timeoutSeconds * 1000;
  for (const raw of c.commands as string[]) {
    const cmd = renderShellTemplate(raw, rc);
    const execCmd = /^"?\$TX_PROJECT_[A-Z0-9_]+"?$/.test(cmd.trim())
      ? `eval "$${cmd.trim().replace(/^"?\$|"$/g, '')}"`
      : cmd;
    const r = await sh(execCmd, wt.worktree, Math.max(1000, deadline - Date.now()), shellEnv);
    results.push({ command: cmd, exitCode: r.code, seconds: Math.round(r.ms / 100) / 10 });
    const passed = r.code === 0 && !r.timedOut;
    // PHP deprecation notices (hundreds of lines at boot) would push the actual failure out of the tail we keep
    const notices = r.out.split('\n').filter(l => /^(PHP )?Deprecated: /.test(l)).length;
    const shown = notices > 0 ? r.out.split('\n').filter(l => !/^(PHP )?Deprecated: /.test(l)).join('\n') : r.out;
    lines.push(
      `## ${passed ? '✅' : '❌'} \`${cmd}\` (exit ${r.timedOut ? 'timeout' : r.code}, ${Math.round(r.ms / 1000)}s)`, '', '```',
      `${notices ? `(${notices} “Deprecated:” notices hidden)\n` : ''}${shown.replace(/\n{3,}/g, '\n\n').slice(-6000).trim() || '(no output)'}`, '```', '',
    );
    if (!passed) {
      ok = false;
      break; // later commands usually depend on earlier ones
    }
  }
  return { port: ok ? 'pass' : 'fail', artifact: { name: c.output, content: lines.join('\n') }, output: { results } };
};

/** Worktree + rendered prompt for an agent step (also used when you pick the executor later). */
export async function prepareAgent(ctx: NodeContext) {
  const c = ctx.config;
  const wt = await worktree(ctx);
  const skill = c.skill ? ctx.skills.get(c.skill) : null;
  const prompt = withSkills(renderTemplate(c.prompt, await renderCtx(ctx, wt)), skill ? [skill] : []);
  return { worktree: wt.worktree, prompt, skillHash: skill?.hash ?? null };
}

/** executor "ask": wait for you to pick (CLI agent or an editor); otherwise start right away. */
const agentRun: NodeExecutor = async ctx => {
  const prepared = await prepareAgent(ctx);
  // the executor you picked for this run (on the run page, or when the step asked) wins; a loop back reuses it
  const picked = ((ctx.run.vars ?? {}) as { executor?: Record<string, AgentExecutor> }).executor?.[ctx.node.id];
  const executor = picked ?? (ctx.config.executor === 'ask' ? undefined : ctx.config.executor);
  if (!executor) return { wait: true, output: { choose: true, worktree: prepared.worktree } };
  const started = await startAgent(ctx, executor, prepared);
  return started.mode === 'running' ? { async: true } : { wait: true, output: started.output };
};

export const slugify = (s: string) =>
  s.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/đ/g, 'd').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50).replace(/-$/, '') || 'ticket';

/** One read-only AI call that drafts a document (shared by doc.write, jira.comment, git.pr). */
async function draft(ctx: NodeContext) {
  const c = ctx.config;
  const wt = await worktree(ctx);
  const skill = c.skill ? ctx.skills.get(c.skill) : null;
  const info = await diffInfo(wt.worktree, wt.baseRef).catch(() => null);
  const prompt = withSkills(renderTemplate(c.prompt, { ...(await renderCtx(ctx, wt)), diff: info?.stat }), skill ? [skill] : []);
  const mcpGrant = ctx.mcp
    ? await ctx.mcp.grantFor({ engine: c.engine ?? 'claude', node: ctx.node.config, projectDirs: [wt.worktree] })
    : undefined;
  const { text, costUsd, numTurns } = await askAgent({
    engine: c.engine, claudeBin: ctx.appConfig.CLAUDE_BIN, geminiBin: ctx.appConfig.GEMINI_BIN, antigravityBin: ctx.appConfig.ANTIGRAVITY_BIN, cwd: wt.worktree, prompt, allowedTools: c.allowedTools,
    timeoutSeconds: c.timeoutSeconds, model: c.model ?? (c.engine === 'claude' ? ctx.appConfig.PLAYBOOK_MODEL : undefined), maxBudgetUsd: c.maxBudgetUsd, logFile: liveLogFile(ctx),
    mcpGrant,
  });
  return { text, wt, info, cost: costUsd, turns: numTurns, skillHash: skill?.hash ?? null };
}

/** Writes the ticket document into the repo and commits only that file on the ticket branch (local). */
const docWrite: NodeExecutor = async ctx => {
  const c = ctx.config;
  const d = await draft(ctx);
  const vars = { ...(await renderCtx(ctx, d.wt)) };
  const rel = renderTemplate(c.path, vars).replace(/\{\{\s*slug\s*\}\}/g, slugify(ctx.task.title));
  const abs = normalize(`${d.wt.worktree}/${rel}`);
  if (relative(d.wt.worktree, abs).startsWith('..') || rel.includes('\0')) throw new FatalNodeError(`Document path leaves the repo: ${rel}`);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, d.text.endsWith('\n') ? d.text : `${d.text}\n`);
  const file = relative(d.wt.worktree, abs);
  await git(d.wt.worktree, ['add', '--', file]);
  const staged = (await git(d.wt.worktree, ['diff', '--cached', '--name-only', '--', file])).trim();
  let commit: string | null = null;
  if (staged) {
    const msg = renderTemplate(c.commitMessage, vars).replace(/\{\{\s*slug\s*\}\}/g, slugify(ctx.task.title));
    await git(d.wt.worktree, ['commit', '--no-verify', '-m', msg, '--', file]);
    commit = (await git(d.wt.worktree, ['rev-parse', '--short', 'HEAD'])).trim();
  }
  return { port: 'next', artifact: { name: c.output, content: d.text }, output: { path: file, commit }, costUsd: d.cost, numTurns: d.turns, skillHash: d.skillHash };
};

const jiraComment: NodeExecutor = async ctx => {
  if (ctx.task.source !== 'jira') return { port: 'skipped', output: { skipped: true, reason: 'not a Jira task' } };
  const d = await draft(ctx);
  return { wait: true, artifact: { name: ctx.config.output, content: d.text }, output: { issueKey: ctx.task.key }, costUsd: d.cost, numTurns: d.turns, skillHash: d.skillHash };
};

const gitPr: NodeExecutor = async ctx => {
  const c = ctx.config;
  const d = await draft(ctx);
  const title = renderTemplate(c.title, await renderCtx(ctx, d.wt)).slice(0, 250);
  const target = c.targetBranch || d.wt.baseRef.replace(/^[^/]+\//, '');
  const dirty = (await git(d.wt.worktree, ['status', '--porcelain'])).split('\n').filter(Boolean);
  return {
    wait: true,
    artifact: { name: c.output, content: d.text },
    output: { title, source: d.wt.branch, target, commits: d.info?.commits ?? [], uncommitted: dirty },
    costUsd: d.cost, numTurns: d.turns, skillHash: d.skillHash,
  };
};

/** Labels the ticket (Claude CLI, rules as fallback) and stores it in the run's vars for skip rules. */
const aiClassify: NodeExecutor = async ctx => {
  await ctx.tasks.ensureDetail(ctx.task.id).catch(() => undefined);
  const task = (await ctx.tasks.getTask(ctx.task.id)) ?? ctx.task;
  const { classification, engine, fallbackReason } = await ctx.classifier.classify({ task, playbooks: [], mappedRepo: null });
  const vars = { ...((ctx.run.vars ?? {}) as object), classification: { ...classification, engine } };
  await ctx.engine.patchRun(ctx.run.id, { vars: JSON.stringify(vars) });
  const md = [
    `**${classification.type}** · automation **${classification.automation}** · confidence ${Math.round(classification.confidence * 100)}% · engine ${engine}`,
    '', classification.reasoning, fallbackReason ? `\n_Fell back to rules: ${fallbackReason}_` : '',
  ].join('\n');
  return { port: 'next', artifact: { name: 'classification', content: md }, output: { ...classification, engine } };
};

/** Waits for you to confirm posting the approved review on the member's PR (or Skip). */
const prComment: NodeExecutor = async ctx => {
  const from = ctx.config.from as string;
  const text = ctx.artifacts[from];
  if (!text?.trim()) return { port: 'skipped', output: { skipped: true, reason: `no "${from}" document to post` } };
  return { wait: true, output: { from, source: ctx.run.branch, target: ctx.run.base_ref, prUrl: ctx.task.review?.prUrl ?? null, draft: text } };
};

export const EXECUTORS: Partial<Record<NodeType, NodeExecutor>> = {
  'pr.comment': prComment,
  'ai.classify': aiClassify,
  'doc.write': docWrite,
  'jira.comment': jiraComment,
  'git.pr': gitPr,
  'trigger.jira': triggerJira,
  'ai.step': aiStep,
  'ai.review': aiReview,
  'check.command': checkCommand,
  'agent.run': agentRun,
};

export type { NodeContext, NodeResult };
