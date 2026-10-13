import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import { promisify } from 'node:util';
import type { AppConfig } from '@ot/config';
import { dataDir } from '@ot/config';
import type { TaskDetailDto } from '@ot/contracts';
import type { WorkflowRun } from '@ot/db';
import { resolveBaseRef } from '@ot/agent-runtime';
import { repoRegistry } from '@ot/mod-repos';
import { BitbucketClient, commentOnPr, findOpenPr, parseBitbucketRemote, parsePrUrl, remoteUrl } from './bitbucket';
import type { WorkflowEngine } from './engine.service';
import { FatalNodeError } from './executors/types';

const exec = promisify(execFile);
const gitEnv = () => ({ ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_SSH_COMMAND: 'ssh -o BatchMode=yes -o ConnectTimeout=15' });
const git = (cwd: string, args: string[], timeout = 120_000) => exec('git', args, { cwd, env: gitEnv(), timeout, maxBuffer: 20 * 1024 * 1024 }).then(r => r.stdout);

/**
 * Worktree for reviewing a member's branch: checked out (detached, read-only use) at <remote>/<source>, compared with
 * <remote>/<target>. Separate from the ot/<KEY> branches used for our own work; your checkouts are not touched.
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
  const baseRef = `${remote}/${target}`;
  if (run.worktree_path !== path || run.base_ref !== baseRef) {
    await engine.patchRun(run.id, { repo_path: entry.path, base_ref: baseRef, branch: review.sourceBranch, worktree_path: path });
    await engine.event(run.id, 'system', 'review_worktree_ready', { path, source: `${remote}/${review.sourceBranch}`, target: baseRef });
  }
  return { worktree: path, repoPath: entry.path, baseRef, branch: review.sourceBranch };
}

/** Posts the approved review on the member's Bitbucket PR (PR from the task's URL, else the open PR for the branch). */
export async function postReviewComment(config: AppConfig, run: WorkflowRun, task: TaskDetailDto, markdown: string) {
  const email = config.BITBUCKET_EMAIL ?? config.JIRA_EMAIL;
  if (!config.BITBUCKET_API_TOKEN || !email) {
    throw new Error('Bitbucket is not configured: add BITBUCKET_API_TOKEN (Atlassian API token with Bitbucket scopes read:repository, read:pullrequest, write:pullrequest) to .env, or Skip.');
  }
  const client = new BitbucketClient({ baseUrl: config.BITBUCKET_API_URL, email, token: config.BITBUCKET_API_TOKEN });
  let pr = task.review?.prUrl ? parsePrUrl(task.review.prUrl) : null;
  if (!pr) {
    const entry = repoRegistry.resolve(task);
    if (!entry || !run.branch) throw new Error('No PR link on the task and no repo/branch to look it up.');
    const repo = entry.bitbucket ? { workspace: entry.bitbucket.split('/')[0]!, slug: entry.bitbucket.split('/')[1]! } : parseBitbucketRemote(await remoteUrl(entry.path, entry.remote ?? 'origin'));
    if (!repo) throw new Error('The repo is not on Bitbucket (or set its Bitbucket workspace/repo on the Repos page).');
    pr = await findOpenPr(client, repo.workspace, repo.slug, run.branch);
    if (!pr) throw new Error(`No open PR found for branch ${run.branch}. Add the PR link to the task.`);
  }
  const { id } = await commentOnPr(client, pr, markdown);
  return { commentId: id, prUrl: pr.url };
}
