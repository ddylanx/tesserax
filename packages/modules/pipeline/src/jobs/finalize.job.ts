import type { AppConfig } from '@ot/config';
import type { RunResult } from '@ot/contracts';
import { createLogger, type JobMeta, type Queue } from '@ot/core';
import type { Db } from '@ot/db';
import { diffInfo, isAlive, readOutcome, stopProcess } from '@ot/agent-runtime';
import type { PipelineService } from '../pipeline.service';
import { STEPS, STEP_RETRY, type StepJobData } from '../states';

const log = createLogger('pipeline.watch');

/** Finds running playbooks that ended (or ran too long) and queues their finalize step. Cheap: file checks only. */
export async function scanRunningPlaybooks(db: Db, queue: Queue, config: AppConfig) {
  const runs = await db
    .selectFrom('pipeline_runs')
    .select(['id', 'attempt', 'run_dir', 'process_id', 'state_changed_at'])
    .where('state', '=', 'running_playbook')
    .where('process_id', 'is not', null)
    .execute();
  for (const r of runs) {
    const tooLong = Date.now() - new Date(r.state_changed_at).getTime() > config.PLAYBOOK_TIMEOUT_SECONDS * 1000;
    const done = !isAlive(r.process_id) || readOutcome(r.run_dir!, r.process_id, false).exitCode !== null;
    if (!done && !tooLong) continue;
    if (tooLong && !done) {
      log.warn({ runId: r.id, pid: r.process_id }, 'playbook run timed out; stopping it');
      stopProcess(r.process_id);
    }
    const data: StepJobData & { timedOut?: boolean } = { runId: r.id, attempt: r.attempt, timedOut: tooLong && !done };
    await queue.send(STEPS.finalize.queue, data, { singletonKey: `${r.id}:finalize:${r.attempt}`, singletonSeconds: 3600, ...STEP_RETRY });
  }
}

/** running_playbook -> awaiting_verify (agent finished) or failed (signal says why). Records summary, diff and usage. */
export async function runFinalizeJob(deps: { pipeline: PipelineService }, data: StepJobData & { timedOut?: boolean }, meta: JobMeta) {
  await deps.pipeline.runStep('finalize', ['running_playbook'], data, meta, async run => {
    const outcome = readOutcome(run.run_dir!, run.process_id, Boolean(data.timedOut));
    if (!outcome.finished) throw new Error('Agent still running'); // retried later
    const baseRef = ((run.decision ?? {}) as { baseRef?: string }).baseRef ?? 'HEAD';
    const diff = run.worktree_path ? await diffInfo(run.worktree_path, baseRef).catch(() => null) : null;
    const r = outcome.result;
    const result: RunResult = {
      exitCode: outcome.exitCode,
      isError: Boolean(r?.is_error) || outcome.signal !== 'ok',
      subtype: r?.subtype ?? null,
      summary: r?.result ?? null,
      durationMs: r?.duration_ms ?? null,
      costUsd: r?.total_cost_usd ?? null,
      numTurns: r?.num_turns ?? null,
      diff: diff ? { files: diff.files, insertions: diff.insertions, deletions: diff.deletions, stat: diff.stat, untracked: diff.untracked } : null,
      commits: diff?.commits ?? [],
      signal: outcome.signal,
    };
    const patch = { result: JSON.stringify({ ...result, base: diff?.base ?? null }), process_id: null };
    if (outcome.signal === 'ok') {
      await deps.pipeline.transition(run.id, {
        from: 'running_playbook', to: 'awaiting_verify', actor: 'job', action: 'playbook_finished', patch,
        detail: { files: result.diff?.files ?? 0, commits: result.commits.length, costUsd: result.costUsd, turns: result.numTurns },
      });
    } else {
      await deps.pipeline.transition(run.id, {
        from: 'running_playbook', to: 'failed', actor: 'job', action: 'playbook_failed',
        patch: { ...patch, error: `${outcome.signal}: ${outcome.message ?? 'unknown error'}`, error_step: 'run' },
        detail: { signal: outcome.signal, message: outcome.message, exitCode: outcome.exitCode },
      });
    }
  });
}
