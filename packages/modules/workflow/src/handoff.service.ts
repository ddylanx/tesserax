import type { AppConfig } from '@ot/config';
import { nodeConfigSchemas, type AgentExecutor } from '@ot/contracts';
import type { Db } from '@ot/db';
import { diffInfo } from '@ot/agent-runtime';
import { ClassificationService } from '@ot/mod-classify';
import { TasksService } from '@ot/mod-tasks';
import { RunConflict, WorkflowEngine } from './engine.service';
import { availableExecutors, openInEditor, startAgent } from './executors/agent';
import { prepareAgent } from './executors';
import type { NodeContext } from './executors/types';
import { SkillStore } from './stores';

/** Choosing who does an agent step, and finishing work done by you in an editor. Built by the controller. */
export class HandoffService {
  constructor(
    private readonly db: Db,
    private readonly config: AppConfig,
    private readonly engine: WorkflowEngine,
    private readonly tasks: TasksService,
    private readonly skills: SkillStore,
    private readonly classifier: ClassificationService,
  ) {}

  executors() {
    return availableExecutors(this.config.CLAUDE_BIN, this.config.GEMINI_BIN, this.config.ANTIGRAVITY_BIN);
  }

  private async waitingAgentNode(runId: string) {
    const nr = await this.db
      .selectFrom('node_runs')
      .selectAll()
      .where('run_id', '=', runId)
      .where('node_type', '=', 'agent.run')
      .where('status', '=', 'waiting')
      .orderBy('seq', 'desc')
      .executeTakeFirst();
    if (!nr) throw new RunConflict('No agent step is waiting on this run.');
    return nr;
  }

  /** The step waits for a choice: start the CLI agent, or open the editor and wait for Done. */
  async choose(runId: string, executor: AgentExecutor) {
    const nr = await this.waitingAgentNode(runId);
    if (!(nr.output as { choose?: boolean })?.choose) throw new RunConflict('An executor was already chosen for this step.');
    const claimed = await this.db.updateTable('node_runs').set({ status: 'running' }).where('id', '=', nr.id).where('status', '=', 'waiting').executeTakeFirst();
    if (!Number(claimed.numUpdatedRows)) throw new RunConflict('This step is already starting.');
    await this.engine.patchRun(runId, { status: 'running' });
    try {
      const run = await this.db.selectFrom('workflow_runs').selectAll().where('id', '=', runId).executeTakeFirstOrThrow();
      const node = this.engine.node(run, nr.node_id);
      const task = await this.tasks.getTask(run.task_id);
      if (!task) throw new Error('Task not found');
      const ctx: NodeContext = {
        engine: this.engine, tasks: this.tasks, classifier: this.classifier, skills: this.skills, appConfig: this.config,
        run, nodeRun: nr, node, config: nodeConfigSchemas['agent.run'].parse(node.config), task,
        artifacts: await this.engine.latestArtifacts(runId), feedback: ((nr.input ?? {}) as { feedback?: string }).feedback ?? null,
      };
      await this.engine.event(runId, 'user', 'executor_chosen', { executor }, nr.id);
      const vars = (run.vars ?? {}) as { executor?: Record<string, string> };
      await this.engine.patchRun(runId, { vars: JSON.stringify({ ...vars, executor: { ...vars.executor, [nr.node_id]: executor } }) });
      const started = await startAgent(ctx, executor, await prepareAgent(ctx));
      if (started.mode === 'handoff') await this.engine.awaitConfirmation(nr.id, started.output, {});
      return { executor, mode: started.mode };
    } catch (err) {
      await this.db.updateTable('node_runs').set({ status: 'waiting', error: String((err as Error).message).slice(0, 2000) }).where('id', '=', nr.id).where('status', '=', 'running').execute();
      await this.engine.patchRun(runId, { status: 'waiting' });
      throw err;
    }
  }

  /** Re-open the worktree in the editor (e.g. after closing it). */
  async reopen(runId: string) {
    const nr = await this.waitingAgentNode(runId);
    const out = (nr.output ?? {}) as { handoff?: AgentExecutor; worktree?: string };
    if (!out.handoff || !out.worktree) throw new RunConflict('This step is not handed off to an editor.');
    await openInEditor(out.handoff, out.worktree);
    return { ok: true };
  }

  /** You finished (or gave up on) the work in the editor: record the changes and continue through done / failed. */
  async finish(runId: string, outcome: 'done' | 'failed', note?: string) {
    const nr = await this.waitingAgentNode(runId);
    const out = (nr.output ?? {}) as { handoff?: AgentExecutor };
    if (!out.handoff) throw new RunConflict('This step is not handed off to an editor.');
    const run = await this.db.selectFrom('workflow_runs').selectAll().where('id', '=', runId).executeTakeFirstOrThrow();
    const node = this.engine.node(run, nr.node_id);
    const diff = run.worktree_path && run.base_ref ? await diffInfo(run.worktree_path, run.base_ref).catch(() => null) : null;
    const content = [
      `Done by you in ${out.handoff.replace('editor:', '')}${outcome === 'failed' ? ' (marked as not finished)' : ''}.`,
      note ? `\nNote: ${note}` : '',
      '',
      '## Changes on the branch',
      diff ? `${diff.files} files, +${diff.insertions} −${diff.deletions}${diff.untracked.length ? `, new: ${diff.untracked.join(', ')}` : ''}` : '(diff unavailable)',
      diff?.commits.length ? `\nCommits:\n${diff.commits.map(c => `- ${c}`).join('\n')}` : '',
      diff?.stat ? `\n\`\`\`\n${diff.stat}\n\`\`\`` : '',
    ].join('\n');
    await this.engine.saveArtifact(runId, nr.id, nodeConfigSchemas['agent.run'].parse(node.config).output, content, 'user');
    await this.engine.complete(nr.id, outcome, { ...(nr.output as object), outcome, note: note ?? null, files: diff?.files ?? 0, commits: diff?.commits.length ?? 0 }, 'user', ['waiting']);
    return { ok: true };
  }
}
