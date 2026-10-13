import type { AppConfig } from '@ot/config';
import { nodeConfigSchemas, type NodeType } from '@ot/contracts';
import { createLogger, type JobMeta, type Queue } from '@ot/core';
import type { Db } from '@ot/db';
import { diffInfo, isAlive, readOutcome, stopProcess } from '@ot/mod-pipeline';
import type { ClassificationService } from '@ot/mod-pipeline';
import type { TasksService } from '@ot/mod-tasks';
import { FINALIZE_QUEUE, STEP_RETRY, type WorkflowEngine } from './engine.service';
import { EXECUTORS } from './executors';
import { engineOf, readGeminiOutcome } from './executors/gemini';
import { FatalNodeError } from './executors/types';
import type { SkillStore } from './stores';

const log = createLogger('workflow.jobs');

export interface JobDeps {
  db: Db;
  engine: WorkflowEngine;
  tasks: TasksService;
  classifier: ClassificationService;
  skills: SkillStore;
  config: AppConfig;
  queue: Queue;
}

/** Runs one queued node. Claiming queued -> running makes duplicate deliveries a no-op. */
export async function runNodeJob(d: JobDeps, { nodeRunId }: { nodeRunId: string }, meta: JobMeta) {
  const nr = await d.db
    .updateTable('node_runs')
    .set({ status: 'running', started_at: new Date(), error: null })
    .where('id', '=', nodeRunId)
    .where('status', '=', 'queued')
    .returningAll()
    .executeTakeFirst();
  if (!nr) return;
  const run = await d.db.selectFrom('workflow_runs').selectAll().where('id', '=', nr.run_id).executeTakeFirstOrThrow();
  if (run.status === 'cancelled') return;
  try {
    const node = d.engine.node(run, nr.node_id);
    const executor = EXECUTORS[node.type as NodeType];
    if (!executor) throw new FatalNodeError(`No executor for node type ${node.type}`);
    const task = await d.tasks.getTask(run.task_id);
    if (!task) throw new FatalNodeError('The task no longer exists');
    const config = nodeConfigSchemas[node.type].parse(node.config);
    const input = (nr.input ?? {}) as { feedback?: string };
    const result = await executor({
      engine: d.engine, tasks: d.tasks, classifier: d.classifier, skills: d.skills, appConfig: d.config, run, nodeRun: nr, node, config, task,
      artifacts: await d.engine.latestArtifacts(run.id), feedback: input.feedback ?? null,
    });
    if ('async' in result) return; // finishes later (agent runs)
    if ('wait' in result) {
      if (result.artifact) await d.engine.saveArtifact(run.id, nr.id, result.artifact.name, result.artifact.content, 'ai');
      await d.engine.awaitConfirmation(nr.id, result.output ?? {}, { cost_usd: result.costUsd ?? null, num_turns: result.numTurns ?? null, skill_hash: result.skillHash ?? null });
      return;
    }
    if (result.artifact) await d.engine.saveArtifact(run.id, nr.id, result.artifact.name, result.artifact.content, 'ai');
    await d.engine.patchNode(nr.id, { cost_usd: result.costUsd ?? null, num_turns: result.numTurns ?? null, skill_hash: result.skillHash ?? null });
    await d.engine.complete(nr.id, result.port, result.output ?? {}, 'job', ['running']);
  } catch (err) {
    const message = String((err as Error)?.message ?? err).slice(0, 4000);
    const fatal = err instanceof FatalNodeError || meta.retryCount >= meta.retryLimit;
    await d.engine.event(run.id, 'job', fatal ? 'node_failed' : 'node_error_retrying', { node: nr.node_id, retry: meta.retryCount, error: message }, nr.id);
    if (fatal) return d.engine.failNode(nr.id, message);
    await d.db.updateTable('node_runs').set({ status: 'queued', error: message }).where('id', '=', nr.id).where('status', '=', 'running').execute();
    throw err;
  }
}

/** Agent nodes that ended (or ran past their timeout) get a finalize job. File checks only. */
export async function scanAgentNodes(d: JobDeps) {
  const rows = await d.db
    .selectFrom('node_runs as n')
    .innerJoin('workflow_runs as r', 'r.id', 'n.run_id')
    .select(['n.id', 'n.node_id', 'n.process_id', 'n.run_dir', 'n.started_at', 'r.workflow_snapshot'])
    .where('n.status', '=', 'running')
    .where('n.node_type', '=', 'agent.run')
    .where('n.process_id', 'is not', null)
    .execute();
  for (const r of rows) {
    const node = d.engine.node(r, r.node_id);
    const timeoutSeconds = nodeConfigSchemas['agent.run'].parse(node.config).timeoutSeconds;
    const tooLong = Date.now() - new Date(r.started_at ?? Date.now()).getTime() > timeoutSeconds * 1000;
    const done = !isAlive(r.process_id) || readOutcome(r.run_dir!, r.process_id, false).exitCode !== null;
    if (!done && !tooLong) continue;
    if (!done) stopProcess(r.process_id);
    await d.queue.send(FINALIZE_QUEUE, { nodeRunId: r.id, timedOut: !done }, { singletonKey: `wf-fin:${r.id}`, singletonSeconds: 3600, ...STEP_RETRY });
  }
}

/** Reads the agent's result, records summary + diff as the node's artifact, and moves on via done/failed. */
export async function finalizeAgentJob(d: JobDeps, data: { nodeRunId: string; timedOut?: boolean }) {
  const nr = await d.db.selectFrom('node_runs').selectAll().where('id', '=', data.nodeRunId).executeTakeFirst();
  if (!nr || nr.status !== 'running') return;
  const run = await d.db.selectFrom('workflow_runs').selectAll().where('id', '=', nr.run_id).executeTakeFirstOrThrow();
  const gemini = engineOf(nr.run_dir) === 'gemini';
  const g = gemini ? readGeminiOutcome(nr.run_dir!, nr.process_id, Boolean(data.timedOut)) : null;
  const outcome = g
    ? { finished: g.finished, exitCode: g.exitCode, signal: g.signal as string, message: g.message, result: { result: g.text ?? undefined, total_cost_usd: undefined, num_turns: undefined } }
    : readOutcome(nr.run_dir!, nr.process_id, Boolean(data.timedOut));
  if (!outcome.finished) throw new Error('Agent still running');
  const diff = run.worktree_path && run.base_ref ? await diffInfo(run.worktree_path, run.base_ref).catch(() => null) : null;
  const r = outcome.result;
  const output = node(run, nr.node_id, d);
  const content = [
    outcome.signal === 'ok' ? '' : `> **The agent stopped: ${outcome.signal}.** ${outcome.message ?? ''}\n`,
    r?.result?.trim() || '(the agent returned no summary)',
    '',
    '## Changes on the branch',
    diff ? `${diff.files} files, +${diff.insertions} −${diff.deletions}${diff.untracked.length ? `, new: ${diff.untracked.join(', ')}` : ''}` : '(diff unavailable)',
    diff?.commits.length ? `\nCommits:\n${diff.commits.map(c => `- ${c}`).join('\n')}` : '',
    diff?.stat ? `\n\`\`\`\n${diff.stat}\n\`\`\`` : '',
  ].join('\n');
  await d.engine.saveArtifact(run.id, nr.id, output, content, 'ai');
  await d.engine.patchNode(nr.id, { cost_usd: r?.total_cost_usd ?? null, num_turns: r?.num_turns ?? null, process_id: null });
  log.info({ runId: run.id, signal: outcome.signal }, 'agent node finished');
  await d.engine.complete(
    nr.id,
    outcome.signal === 'ok' ? 'done' : 'failed',
    { signal: outcome.signal, message: outcome.message, exitCode: outcome.exitCode, files: diff?.files ?? 0, commits: diff?.commits.length ?? 0 },
    'job',
    ['running'],
  );
}

function node(run: { workflow_snapshot: unknown }, nodeId: string, d: JobDeps): string {
  const n = d.engine.node(run as never, nodeId);
  return nodeConfigSchemas['agent.run'].parse(n.config).output;
}
