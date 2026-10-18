import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import { promisify } from 'node:util';
import type { AppConfig } from '@tesserax/config';
import { dataDir } from '@tesserax/config';
import type { PrProvider, PrRef, TaskDetailDto } from '@tesserax/contracts';
import type { WorkflowRun } from '@tesserax/db';
import { resolveBaseRef } from '@tesserax/agent-runtime';
import { repoRegistry } from '@tesserax/mod-repos';
import { remoteUrl } from './bitbucket';
import type { WorkflowEngine } from './engine.service';
import { FatalNodeError } from './executors/types';
import { PrProviderRegistry } from './providers/pr-provider.registry';
import { ensureWorktreeLinks, getProjectVars } from './worktree-links';

const exec = promisify(execFile);
const gitEnv = () => ({ ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_SSH_COMMAND: 'ssh -o BatchMode=yes -o ConnectTimeout=15' });
const git = (cwd: string, args: string[], timeout = 120_000) => exec('git', args, { cwd, env: gitEnv(), timeout, maxBuffer: 20 * 1024 * 1024 }).then(r => r.stdout);

/**
 * Worktree for reviewing a member's branch: checked out (detached, read-only use) at <remote>/<source>, compared with
 * <remote>/<target>. Separate from the tx/<KEY> branches used for our own work; your checkouts are not touched.
 */
export async function ensureReviewWorktree(engine: WorkflowEngine, config: AppConfig, run: WorkflowRun, task: TaskDetailDto) {
  const review = task.review!;
  const entry = repoRegistry.resolve(task);
  if (!entry) throw new FatalNodeError(`No workplace for this task (project ${task.project ?? '(none)'}). Register one on the Repos page or pick one on the task, then Retry.`);
  const remote = entry.remote ?? 'origin';
  const base = await resolveBaseRef(entry.path, entry.base).catch(() => `${remote}/develop`);
  const target = review.targetBranch ?? base.replace(/^[^/]+\//, '');
  try {
    await git(entry.path, ['fetch', '--quiet', remote, review.sourceBranch, target]);
  } catch (e) {
    throw new FatalNodeError(`git fetch ${remote} ${review.sourceBranch} ${target} failed: ${String((e as { stderr?: string }).stderr ?? (e as Error).message).trim().slice(0, 400)}`);
  }
  const repoId = `${basename(entry.path)}-${createHash('sha1').update(entry.path).digest('hex').slice(0, 6)}`;
  const dir = join(dataDir(config), 'worktrees', repoId);
  const path = join(dir, `review__${(task.key ?? run.id.slice(0, 8)).replace(/[^\w.-]+/g, '-')}`);
  mkdirSync(dir, { recursive: true });
  if (existsSync(path)) await git(path, ['checkout', '--quiet', '--detach', `${remote}/${review.sourceBranch}`]);
  else {
    await git(entry.path, ['worktree', 'prune']);
    await git(entry.path, ['worktree', 'add', '--quiet', '--detach', path, `${remote}/${review.sourceBranch}`]);
  }
  const projectVars = getProjectVars(run.vars);
  ensureWorktreeLinks({ repoPath: entry.path, worktreePath: path, linksRaw: projectVars.worktree_links });
  const baseRef = `${remote}/${target}`;
  if (run.worktree_path !== path || run.base_ref !== baseRef) {
    await engine.patchRun(run.id, { repo_path: entry.path, base_ref: baseRef, branch: review.sourceBranch, worktree_path: path });
    await engine.event(run.id, 'system', 'review_worktree_ready', { path, source: `${remote}/${review.sourceBranch}`, target: baseRef });
  }
  return { worktree: path, repoPath: entry.path, baseRef, branch: review.sourceBranch };
}

/** Posts the approved review on the member's PR using the resolved PR provider. */
export async function postReviewComment(prRegistry: PrProviderRegistry, run: WorkflowRun, task: TaskDetailDto, markdown: string) {
  let resolvedPr: { provider: PrProvider; pr: PrRef } | null = null;
  if (task.review?.prUrl) {
    resolvedPr = prRegistry.parsePrUrl(task.review.prUrl);
    if (!resolvedPr) {
      throw new Error(`Unsupported PR URL: "${task.review.prUrl}". No matching PR provider found.`);
    }
  } else {
    const entry = repoRegistry.resolve(task);
    if (!entry || !run.branch) throw new Error('No PR link on the task and no repo/branch to look it up.');
    const explicitKind = entry.pr ?? (entry.bitbucket ? 'bitbucket' : null);
    const gitRemoteUrl = entry.bitbucket ?? (await remoteUrl(entry.path, entry.remote ?? 'origin'));
    const resolved = prRegistry.resolve(gitRemoteUrl, explicitKind);
    if (!resolved) {
      throw new Error('The repo does not match any PR provider (or set its provider / workspace on the Repos page).');
    }
    const foundPr = await resolved.provider.findOpenPr(resolved.repo, run.branch);
    if (!foundPr) throw new Error(`No open PR found for branch ${run.branch}. Add the PR link to the task.`);
    resolvedPr = { provider: resolved.provider, pr: foundPr };
  }
  const { id } = await resolvedPr.provider.comment(resolvedPr.pr, markdown);
  return { commentId: id, prUrl: resolvedPr.pr.url };
}
