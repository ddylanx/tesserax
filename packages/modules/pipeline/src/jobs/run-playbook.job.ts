import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { dataDir, type AppConfig } from '@tesserax/config';
import type { DecisionInput } from '@tesserax/contracts';
import type { JobMeta } from '@tesserax/core';
import type { TasksService } from '@tesserax/mod-tasks';
import { ensureWorktree, fetchBase, launchDetached } from '@tesserax/agent-runtime';
import type { PipelineService } from '../pipeline.service';
import { renderPlaybook, type PlaybookRegistry } from '../playbooks';
import type { StepJobData } from '../states';

/**
 * queued -> running_playbook: worktree + branch tx/<KEY>, then `claude -p` started detached in it.
 * The job ends once the agent is started; pipeline.finalize picks up the result (see watcher).
 */
export async function runPlaybookJob(
  deps: { pipeline: PipelineService; tasks: TasksService; playbooks: PlaybookRegistry; config: AppConfig },
  data: StepJobData,
  meta: JobMeta,
) {
  await deps.pipeline.runStep('run', ['queued', 'running_playbook'], data, meta, async run => {
    if (run.process_id) return; // already launched for this attempt (job redelivered)
    const playbook = deps.playbooks.get(run.playbook_id ?? '');
    if (!playbook) throw new Error(`Playbook ${run.playbook_id} not found in playbooks/`);
    if (!run.repo_path || !run.branch) throw new Error('No repo or branch on the run; decide again.');

    const sessionId = randomUUID();
    const runDir = join(dataDir(deps.config), 'runs', run.id, String(run.attempt));
    if (run.state === 'queued') {
      await deps.pipeline.transition(run.id, {
        from: 'queued', to: 'running_playbook', actor: 'job', action: 'start_playbook',
        patch: { agent_session_id: sessionId, run_dir: runDir, result: null },
        detail: { playbook: playbook.id, attempt: run.attempt },
      });
    } else {
      await deps.pipeline.patch(run.id, { agent_session_id: sessionId, run_dir: runDir });
    }

    const decisionBase = ((run.decision ?? {}) as Partial<DecisionInput>).baseRef ?? 'HEAD';
    const fetched = await fetchBase(run.repo_path, decisionBase);
    const { path: worktree, created } = await ensureWorktree(run.repo_path, run.branch, dataDir(deps.config), decisionBase);
    await deps.pipeline.patch(run.id, { worktree_path: worktree });
    await deps.pipeline.note(run.id, 'job', created ? 'worktree_created' : 'worktree_reused', { worktree, branch: run.branch, base: decisionBase, fetched });

    const task = await deps.tasks.getTask(run.task_id);
    if (!task) throw new Error('Task no longer exists');
    const decision = (run.decision ?? {}) as Partial<DecisionInput>;
    const prompt = renderPlaybook(playbook, { task, branch: run.branch, repoPath: run.repo_path, worktreePath: worktree, note: decision.note });

    // Cancelled while we were preparing? Do not start the agent.
    const current = await deps.pipeline.getRun(run.id);
    if (current?.state !== 'running_playbook') return;

    const pid = launchDetached({
      bin: deps.config.CLAUDE_BIN,
      cwd: worktree,
      runDir,
      prompt,
      sessionId,
      permissionMode: playbook.permissionMode,
      allowedTools: playbook.allowedTools,
      maxBudgetUsd: playbook.maxBudgetUsd,
      model: deps.config.PLAYBOOK_MODEL,
    });
    await deps.pipeline.patch(run.id, { process_id: pid });
    await deps.pipeline.note(run.id, 'job', 'agent_started', { pid, sessionId, runDir, permissionMode: playbook.permissionMode });
  });
}
