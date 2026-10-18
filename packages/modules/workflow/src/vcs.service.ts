import { Inject, Injectable } from '@nestjs/common';
import { dataDir, type AppConfig } from '@tesserax/config';
import type { ConfirmAction } from '@tesserax/contracts';
import { CONFIG, DB } from '@tesserax/core';
import type { Db, NodeRun, WorkflowRun } from '@tesserax/db';
import { diffInfo, ensureWorktree, fetchBase, resolveBaseRef } from '@tesserax/agent-runtime';
import { repoRegistry } from '@tesserax/mod-repos';
import { TasksService } from '@tesserax/mod-tasks';
import { pushBranch, remoteUrl } from './bitbucket';
import { PrProviderRegistry } from './providers/pr-provider.registry';
import { ensureWorktreeLinks, getProjectVars } from './worktree-links';

@Injectable()
export class WorkflowVcsService {
  constructor(
    @Inject(CONFIG) private readonly config: AppConfig,
    @Inject(DB) private readonly db: Db,
    private readonly tasks: TasksService,
    private readonly prRegistry: PrProviderRegistry,
  ) {}

  /**
   * The run's worktree on branch tx/<KEY>, created from the project's base branch the first time a node needs code.
   */
  async ensureRunWorktree(runId: string): Promise<{
    worktree: string;
    repoPath: string;
    baseRef: string;
    branch: string;
    created?: boolean;
    fetched?: boolean;
  }> {
    const run = await this.db.selectFrom('workflow_runs').selectAll().where('id', '=', runId).executeTakeFirstOrThrow();
    if (run.worktree_path && run.repo_path && run.base_ref && run.branch) {
      const { path } = await ensureWorktree(run.repo_path, run.branch, dataDir(this.config), run.base_ref);
      const projectVars = getProjectVars(run.vars);
      ensureWorktreeLinks({ repoPath: run.repo_path, worktreePath: path, linksRaw: projectVars.worktree_links });
      return { worktree: path, repoPath: run.repo_path, baseRef: run.base_ref, branch: run.branch };
    }
    const task = await this.tasks.getTask(run.task_id);
    const entry = task ? repoRegistry.resolve(task) : null;
    if (!entry) {
      throw new Error(`No workplace for this task (project ${task?.project ?? '(none)'}). Register one on the Repos page or pick one on the task, then Retry.`);
    }
    const baseRef = await resolveBaseRef(entry.path, entry.base);
    const fetched = await fetchBase(entry.path, baseRef);
    const branch = run.branch ?? `tx/${task?.key ?? run.id.slice(0, 8)}`;
    const { path, created } = await ensureWorktree(entry.path, branch, dataDir(this.config), baseRef);
    const projectVars = getProjectVars(run.vars);
    ensureWorktreeLinks({ repoPath: entry.path, worktreePath: path, linksRaw: projectVars.worktree_links });

    await this.db
      .updateTable('workflow_runs')
      .set({ repo_path: entry.path, base_ref: baseRef, branch, worktree_path: path, updated_at: new Date() })
      .where('id', '=', runId)
      .execute();

    return { worktree: path, repoPath: entry.path, baseRef, branch, created, fetched };
  }

  async openPullRequest(run: WorkflowRun, nr: NodeRun, a: Extract<ConfirmAction, { action: 'confirm' }>) {
    if (!run.worktree_path || !run.repo_path || !run.branch || !run.base_ref) {
      throw new Error('This run has no worktree/branch yet.');
    }
    const out = (nr.output ?? {}) as { title?: string; target?: string };
    const task = await this.tasks.getTask(run.task_id);
    const entry = task ? repoRegistry.resolve(task) : null;
    const remote = entry?.remote ?? (run.base_ref.includes('/') ? run.base_ref.split('/')[0]! : 'origin');
    const target = a.targetBranch ?? out.target ?? run.base_ref.replace(/^[^/]+\//, '');
    const title = a.title ?? out.title ?? `${task?.key ?? ''}`;
    const commits = (await diffInfo(run.worktree_path, run.base_ref)).commits;
    if (!commits.length) {
      throw new Error(`Nothing is committed on ${run.branch} compared with ${run.base_ref}; there is nothing to open a PR for.`);
    }
    const explicitKind = entry?.pr ?? (entry?.bitbucket ? 'bitbucket' : null);
    const gitRemoteUrl = entry?.bitbucket ?? (await remoteUrl(run.repo_path, remote));
    const resolved = this.prRegistry.resolve(gitRemoteUrl, explicitKind);
    if (!resolved) {
      const hint = explicitKind
        ? `Provider "${explicitKind}" could not detect repository from "${gitRemoteUrl}".`
        : `Remote "${remote}" is not supported by any PR provider; configure "pr" or set repository details on the Repos page.`;
      throw new Error(hint);
    }
    const pushLog = await pushBranch(run.worktree_path, remote, run.branch).catch(e => {
      throw new Error(`git push failed: ${String((e as { stderr?: string }).stderr ?? (e as Error).message).trim().slice(0, 800)}`);
    });
    const pr = await resolved.provider.createPr(resolved.repo, {
      title,
      body: a.text,
      source: run.branch,
      target,
    });
    return {
      prUrl: pr.url,
      prId: pr.id,
      existingPr: pr.existing,
      target,
      pushed: run.branch,
      commits: commits.length,
      pushLog: pushLog.slice(0, 500),
    };
  }

  async postTaskComment(run: WorkflowRun, text: string) {
    const task = await this.tasks.getTask(run.task_id);
    const result = await this.tasks.postComment(run.task_id, text);
    return {
      commentId: result.id,
      issueKey: task?.key ?? null,
      commentUrl: result.url ?? null,
    };
  }

  async postJiraComment(run: WorkflowRun, text: string) {
    return this.postTaskComment(run, text);
  }
}
