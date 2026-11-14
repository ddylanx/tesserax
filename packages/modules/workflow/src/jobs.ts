import type { AppConfig } from '@tesserax/config';
import { ROLE_NODE_TYPES, nodeConfigSchemas, parseStepReport, type NodeType, type RoleLookup } from '@tesserax/contracts';
import { createLogger, type JobMeta, type Queue } from '@tesserax/core';
import type { Db } from '@tesserax/db';
import { diffInfo, isAlive, readOutcome, resultModel, stopProcess } from '@tesserax/agent-runtime';
import type { ClassificationService } from '@tesserax/mod-classify';
import type { TasksService } from '@tesserax/mod-tasks';
import { FINALIZE_QUEUE, NODE_QUEUE, STEP_RETRY, type WorkflowEngine } from './engine.service';
import { EXECUTORS } from './executors';
import { readAntigravityOutcome } from './executors/antigravity';
import { engineOf, readGeminiOutcome } from './executors/gemini';
import { FatalNodeError } from './executors/types';
import { projectSkills } from './project-skills';
import { applyRunOverrides, resolveRole, runRoleLookup } from './apply-role';
import type { SkillCatalog } from '@tesserax/mod-skills';
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { McpService } from '@tesserax/mod-mcp';

const log = createLogger('workflow.jobs');

/** Summary, confidence and decision from the report an AI step ends with (summary falls back to the first lines). */
export function reportPatch(nodeType: string, text: string | null | undefined) {
  if (!text?.trim() || !(ROLE_NODE_TYPES as readonly string[]).includes(nodeType)) return {};
  const r = parseStepReport(text);
  return { summary: r.summary || null, confidence: r.confidence, decision_needed: r.decisionNeeded };
}

/**
 * Hands the improvement proposals a role-driven step ended its report with to the Team module; the owner decides on the
 * Context page. Never fails the step.
 */
export async function keepImprovements(roles: RoleLookup | undefined, roleKey: string | null | undefined, text: string | null | undefined, source: string): Promise<number> {
  if (!roleKey || !text?.trim() || !roles?.proposeImprovements) return 0;
  const items = parseStepReport(text).improvements;
  if (!items.length) return 0;
  try {
    return await roles.proposeImprovements(roleKey, items, source);
  } catch (err) {
    log.warn({ err, role: roleKey }, 'could not save improvement proposals');
    return 0;
  }
}

/** Where a proposal came from, as the Context page links it. */
export const proposalSource = (runId: string, nodeId: string) => `run:${runId}:${nodeId}`;

export interface JobDeps {
  db: Db;
  engine: WorkflowEngine;
  tasks: TasksService;
  classifier: ClassificationService;
  skills: SkillCatalog;
  config: AppConfig;
  queue: Queue;
  mcp?: McpService;
  /** Team roles (ROLE_LOOKUP); without it a node that names a role fails. */
  roles?: RoleLookup;
}

/** Node runs executing in this process right now (to tell them apart from ones orphaned by a restart). */
const inFlight = new Set<string>();

/**
 * A restart (e.g. the dev server reloading) kills steps that were executing; their rows stay "running" and the
 * retried job would skip them. Re-queue any non-agent step marked running that this process is not executing.
 * Agent runs are separate processes and are finalized by scanAgentNodes instead.
 */
export async function recoverOrphanedNodes(d: JobDeps) {
  const rows = await d.db
    .selectFrom('node_runs')
    .select(['id', 'run_id', 'node_id', 'started_at'])
    .where('status', '=', 'running')
    .where('node_type', '!=', 'agent.run')
    .where('started_at', '<', new Date(Date.now() - 30_000))
    .execute();
  for (const r of rows) {
    if (inFlight.has(r.id)) continue;
    const reset = await d.db.updateTable('node_runs').set({ status: 'queued' }).where('id', '=', r.id).where('status', '=', 'running').executeTakeFirst();
    if (!Number(reset.numUpdatedRows)) continue;
    await d.engine.event(r.run_id, 'system', 'node_requeued', { node: r.node_id, reason: 'was interrupted (server restart)' }, r.id);
    await d.queue.send(NODE_QUEUE, { nodeRunId: r.id }, { singletonKey: `wf:${r.id}:recover:${Date.now()}`, ...STEP_RETRY });
    log.warn({ nodeRunId: r.id, node: r.node_id }, 'interrupted step re-queued');
  }
}

/** Runs one queued node. Claiming queued -> running makes duplicate deliveries a no-op. */
export async function runNodeJob(d: JobDeps, data: { nodeRunId: string }, meta: JobMeta) {
  inFlight.add(data.nodeRunId);
  try {
    return await runNodeJobInner(d, data, meta);
  } finally {
    inFlight.delete(data.nodeRunId);
  }
}

async function runNodeJobInner(d: JobDeps, { nodeRunId }: { nodeRunId: string }, meta: JobMeta) {
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
    const project = run.project_id ? await d.engine.projects.get(run.project_id) : null;
    // run override > field set in the node > its Team role > the node type's default; the project's engines are enforced last
    const { config: raw, role } = await resolveRole(runRoleLookup(run.vars, d.roles), node, project);
    if (role) await d.engine.patchNode(nr.id, { role: role.key, role_hash: role.hash });
    const config = nodeConfigSchemas[node.type].parse(raw);
    const { modelOverride } = applyRunOverrides(config as Record<string, unknown>, node, run.vars);
    if (project && 'engine' in config) {
      const allowed = project.settings.engines.allowed;
      const current = String((config as { engine?: string }).engine ?? '');
      if (allowed && current && !allowed.includes(current)) {
        const fallback = project.settings.engines.default;
        if (!fallback || !allowed.includes(fallback)) throw new FatalNodeError(`Engine "${current}" is not allowed in project "${project.name}" (allowed: ${allowed.join(', ') || 'none'}).`);
        Object.assign(config, { engine: fallback, ...(modelOverride ? {} : { model: undefined }) });
      }
    }
    const input = (nr.input ?? {}) as { feedback?: string };
    const projectVars = ((run.vars ?? {}) as { project?: { vars?: Record<string, string> } }).project?.vars ?? {};
    const result = await executor({
      engine: d.engine, tasks: d.tasks, classifier: d.classifier, skills: projectSkills(d.skills, project), projectVars, appConfig: d.config, run, nodeRun: nr,
      node: { ...node, config: raw }, config, task, role, artifacts: await d.engine.latestArtifacts(run.id), feedback: input.feedback ?? null, mcp: d.mcp,
    });
    if ('async' in result) return; // finishes later (agent runs)
    await keepImprovements(d.roles, role?.key, result.artifact?.content, proposalSource(run.id, nr.node_id));
    if ('wait' in result) {
      if (result.artifact) await d.engine.saveArtifact(run.id, nr.id, result.artifact.name, result.artifact.content, 'ai');
      await d.engine.awaitConfirmation(nr.id, result.output ?? {}, { cost_usd: result.costUsd ?? null, num_turns: result.numTurns ?? null, model: result.model ?? null, skill_hash: result.skillHash ?? null, ...reportPatch(nr.node_type, result.artifact?.content) });
      return;
    }
    if (result.artifact) await d.engine.saveArtifact(run.id, nr.id, result.artifact.name, result.artifact.content, 'ai');
    await d.engine.patchNode(nr.id, { cost_usd: result.costUsd ?? null, num_turns: result.numTurns ?? null, model: result.model ?? null, skill_hash: result.skillHash ?? null, ...reportPatch(nr.node_type, result.artifact?.content) });
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
  await recoverOrphanedNodes(d).catch(err => log.warn({ err }, 'recovering interrupted steps failed'));
  const rows = await d.db
    .selectFrom('node_runs as n')
    .innerJoin('workflow_runs as r', 'r.id', 'n.run_id')
    .select(['n.id', 'n.node_id', 'n.process_id', 'n.run_dir', 'n.started_at', 'r.workflow_snapshot', 'r.vars'])
    .where('n.status', '=', 'running')
    .where('n.node_type', '=', 'agent.run')
    .where('n.process_id', 'is not', null)
    .execute();
  for (const r of rows) {
    const node = d.engine.node(r, r.node_id);
    const raw = await resolveRole(runRoleLookup(r.vars, d.roles), node, null).then(x => x.config, () => node.config);
    const timeoutSeconds = nodeConfigSchemas['agent.run'].parse(raw).timeoutSeconds;
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
  const engine = engineOf(nr.run_dir);
  const g = engine === 'gemini' ? readGeminiOutcome(nr.run_dir!, nr.process_id, Boolean(data.timedOut))
    : engine === 'antigravity' ? readAntigravityOutcome(nr.run_dir!, nr.process_id, Boolean(data.timedOut))
    : null;
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
  const usedModel = resultModel(r);
  await d.engine.patchNode(nr.id, { cost_usd: r?.total_cost_usd ?? null, num_turns: r?.num_turns ?? null, process_id: null, ...(usedModel ? { model: usedModel } : {}), ...reportPatch(nr.node_type, r?.result) });
  await keepImprovements(d.roles, nr.role, r?.result, proposalSource(run.id, nr.node_id));
  log.info({ runId: run.id, signal: outcome.signal }, 'agent node finished');
  if (nr.run_dir) {
    const mcpFile = join(nr.run_dir, 'mcp.json');
    if (existsSync(mcpFile)) {
      try {
        rmSync(mcpFile, { force: true });
      } catch {
        /* ignore */
      }
    }
  }
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
