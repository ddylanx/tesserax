import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { dataDir } from '@ot/config';
import type { NodeType } from '@ot/contracts';
import { cleanEnv, diffInfo, diffPatch, git, launchDetached } from '@ot/mod-pipeline';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, normalize, relative } from 'node:path';
import { renderTemplate, withSkills } from '../render';
import { askClaude } from './claude';
import { FatalNodeError, type NodeContext, type NodeExecutor, type NodeResult } from './types';

async function renderCtx(ctx: NodeContext, extra: { worktree?: string; repoPath?: string; baseRef?: string; branch?: string; diff?: string } = {}) {
  return {
    task: ctx.task, artifacts: ctx.artifacts, feedback: ctx.feedback,
    branch: extra.branch ?? ctx.run.branch, baseRef: extra.baseRef ?? ctx.run.base_ref, worktreePath: extra.worktree ?? ctx.run.worktree_path,
    repoPath: extra.repoPath ?? ctx.run.repo_path, diff: extra.diff,
  };
}

const worktree = async (ctx: NodeContext) => {
  try {
    return await ctx.engine.ensureRunWorktree(ctx.run.id);
  } catch (e) {
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
  const { text, run } = await askClaude({
    bin: ctx.appConfig.CLAUDE_BIN, cwd: wt.worktree, prompt, allowedTools: c.allowedTools, timeoutSeconds: c.timeoutSeconds,
    model: c.model ?? ctx.appConfig.PLAYBOOK_MODEL, maxBudgetUsd: c.maxBudgetUsd,
  });
  return {
    port: 'next', artifact: { name: c.output, content: text }, output: { chars: text.length },
    costUsd: run.result?.total_cost_usd ?? null, numTurns: run.result?.num_turns ?? null, skillHash: skill?.hash ?? null,
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
  const { text, run } = await askClaude({
    bin: ctx.appConfig.CLAUDE_BIN, cwd: wt.worktree, prompt, allowedTools: c.allowedTools, timeoutSeconds: c.timeoutSeconds,
    model: c.model ?? ctx.appConfig.PLAYBOOK_MODEL, maxBudgetUsd: c.maxBudgetUsd,
  });
  const verdict = [...text.matchAll(/VERDICT:\s*(PASS|FAIL)/gi)].at(-1)?.[1]?.toUpperCase();
  if (!verdict) throw new Error('The review did not end with VERDICT: PASS or VERDICT: FAIL');
  return {
    port: verdict === 'PASS' ? 'pass' : 'fail', artifact: { name: c.output, content: text },
    output: { verdict, filesChanged: info.files }, costUsd: run.result?.total_cost_usd ?? null, numTurns: run.result?.num_turns ?? null,
    skillHash: skills.map(s => s.hash).join(',') || null,
  };
};

function sh(cmd: string, cwd: string, timeoutMs: number): Promise<{ code: number | null; out: string; ms: number; timedOut: boolean }> {
  return new Promise(resolve => {
    const started = Date.now();
    let out = '';
    let timedOut = false;
    const child = spawn('/bin/sh', ['-c', cmd], { cwd, env: cleanEnv(), detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const keep = (d: Buffer) => {
      out = (out + d.toString()).slice(-20_000);
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
  const lines: string[] = [`# Checks in ${wt.worktree}`, ''];
  const results: { command: string; exitCode: number | null; seconds: number }[] = [];
  let ok = true;
  const deadline = Date.now() + c.timeoutSeconds * 1000;
  for (const raw of c.commands as string[]) {
    const cmd = renderTemplate(raw, rc);
    const r = await sh(cmd, wt.worktree, Math.max(1000, deadline - Date.now()));
    results.push({ command: cmd, exitCode: r.code, seconds: Math.round(r.ms / 100) / 10 });
    const passed = r.code === 0 && !r.timedOut;
    lines.push(`## ${passed ? '✅' : '❌'} \`${cmd}\` (exit ${r.timedOut ? 'timeout' : r.code}, ${Math.round(r.ms / 1000)}s)`, '', '```', r.out.slice(-6000).trim() || '(no output)', '```', '');
    if (!passed) {
      ok = false;
      break; // later commands usually depend on earlier ones
    }
  }
  return { port: ok ? 'pass' : 'fail', artifact: { name: c.output, content: lines.join('\n') }, output: { results } };
};

const agentRun: NodeExecutor = async ctx => {
  const c = ctx.config;
  const wt = await worktree(ctx);
  const skill = c.skill ? ctx.skills.get(c.skill) : null;
  const prompt = withSkills(renderTemplate(c.prompt, await renderCtx(ctx, wt)), skill ? [skill] : []);
  const sessionId = randomUUID();
  const runDir = join(dataDir(ctx.appConfig), 'runs', ctx.run.id, ctx.nodeRun.id);
  const pid = launchDetached({
    bin: ctx.appConfig.CLAUDE_BIN, cwd: wt.worktree, runDir, prompt, sessionId,
    permissionMode: c.permissionMode, allowedTools: c.allowedTools, maxBudgetUsd: c.maxBudgetUsd, model: c.model ?? ctx.appConfig.PLAYBOOK_MODEL,
  });
  await ctx.engine.patchNode(ctx.nodeRun.id, { process_id: pid, run_dir: runDir, agent_session_id: sessionId, skill_hash: skill?.hash ?? null });
  await ctx.engine.event(ctx.run.id, 'job', 'agent_started', { pid, sessionId, worktree: wt.worktree }, ctx.nodeRun.id);
  return { async: true };
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
  const { text, run } = await askClaude({
    bin: ctx.appConfig.CLAUDE_BIN, cwd: wt.worktree, prompt, allowedTools: c.allowedTools, timeoutSeconds: c.timeoutSeconds,
    model: c.model ?? ctx.appConfig.PLAYBOOK_MODEL, maxBudgetUsd: c.maxBudgetUsd,
  });
  return { text, wt, info, cost: run.result?.total_cost_usd ?? null, turns: run.result?.num_turns ?? null, skillHash: skill?.hash ?? null };
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

export const EXECUTORS: Partial<Record<NodeType, NodeExecutor>> = {
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
