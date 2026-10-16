import {
  BadRequestException, Body, ConflictException, Controller, Get, HttpCode, Inject, NotFoundException, Param, ParseUUIDPipe, Post, Put, Query,
} from '@nestjs/common';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AppConfig } from '@tesserax/config';
import {
  NODE_PORTS, NODE_TYPES, NODE_TYPE_INFO, prCommentActionSchema, confirmActionSchema, evaluateActionSchema, executorActionSchema, handoffActionSchema, nodeAgentActionSchema, rerunNodeActionSchema, runFromActionSchema, gateActionSchema, nodeConfigJsonSchema, trySkillSchema,
  routingSchema, workflowSchema, type RunDiff, type WorkflowRunDetail, type WorkflowRunList,
} from '@tesserax/contracts';
import { CONFIG, DB } from '@tesserax/core';
import type { Db } from '@tesserax/db';
import { diffInfo, diffPatch } from '@tesserax/agent-runtime';
import { ClassificationService } from '@tesserax/mod-classify';
import { TasksService } from '@tesserax/mod-tasks';
import { repoRegistry } from '@tesserax/mod-repos';
import { askClaude } from './executors/claude';
import { nodeRunDir, readLiveLog } from './executors/livelog';
import { renderTemplate, withSkills } from './render';
import { RunConflict, WorkflowEngine } from './engine.service';
import { HandoffService } from './handoff.service';
import { postReviewComment } from './review';
import { computeMetrics } from './metrics';
import { SkillCatalog } from '@tesserax/mod-skills';

async function guard<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof RunConflict) throw new ConflictException(e.message);
    if (e instanceof Error && !('status' in e)) throw new BadRequestException(e.message);
    throw e;
  }
}

@Controller()
export class WorkflowController {
  constructor(
    private readonly engine: WorkflowEngine,
    private readonly skills: SkillCatalog,
    private readonly tasks: TasksService,
    @Inject(CONFIG) private readonly config: AppConfig,
    @Inject(DB) private readonly db: Db,
    classifier: ClassificationService,
  ) {
    this.handoff = new HandoffService(db, config, engine, tasks, skills, classifier);
  }

  private readonly handoff: HandoffService;

  /** Who can do agent steps on this machine (CLI agents and installed editors). */
  @Get('agent-executors')
  agentExecutors() {
    return this.handoff.executors();
  }

  @Post('workflow-runs/:id/executor')
  @HttpCode(200)
  chooseExecutor(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const parsed = executorActionSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Pick one of the listed executors.');
    return guard(() => this.handoff.choose(id, parsed.data.executor));
  }

  /** Who does one step in this run only (engine for AI steps, executor for agent steps); agent null = the workflow's choice. */
  @Post('workflow-runs/:id/agent')
  @HttpCode(200)
  setNodeAgent(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const parsed = nodeAgentActionSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues[0]?.message ?? 'Invalid body');
    return guard(() => this.engine.setNodeAgent(id, parsed.data.nodeId, parsed.data.agent));
  }

  /** Post the approved review on the member's PR (confirm: true + the exact text), or skip. */
  @Post('workflow-runs/:id/pr-comment')
  @HttpCode(200)
  prComment(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const parsed = prCommentActionSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Needs { action: "confirm", confirm: true, text } or { action: "skip" }.');
    return guard(async () => {
      const nr = await this.db.selectFrom('node_runs').selectAll().where('run_id', '=', id).where('node_type', '=', 'pr.comment').where('status', '=', 'waiting').orderBy('seq', 'desc').executeTakeFirst();
      if (!nr) throw new RunConflict('No PR comment is waiting on this run.');
      if (parsed.data.action === 'skip') {
        await this.engine.complete(nr.id, 'skipped', { skipped: true }, 'user', ['waiting']);
        return { skipped: true };
      }
      const claimed = await this.db.updateTable('node_runs').set({ status: 'running', error: null }).where('id', '=', nr.id).where('status', '=', 'waiting').executeTakeFirst();
      if (!Number(claimed.numUpdatedRows)) throw new RunConflict('Already being posted.');
      try {
        const run = await this.db.selectFrom('workflow_runs').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
        const task = await this.tasks.getTask(run.task_id);
        const result = await postReviewComment(this.config, run, task!, parsed.data.text);
        await this.engine.event(id, 'user', 'pr_comment_posted', result, nr.id);
        await this.engine.complete(nr.id, 'posted', { ...(nr.output as object), ...result }, 'user', ['running']);
        return result;
      } catch (e) {
        await this.db.updateTable('node_runs').set({ status: 'waiting', error: String((e as Error).message).slice(0, 2000) }).where('id', '=', nr.id).where('status', '=', 'running').execute();
        throw e;
      }
    });
  }

  @Post('workflow-runs/:id/handoff/reopen')
  @HttpCode(200)
  reopenEditor(@Param('id', ParseUUIDPipe) id: string) {
    return guard(() => this.handoff.reopen(id));
  }

  @Post('workflow-runs/:id/handoff/finish')
  @HttpCode(200)
  finishHandoff(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const parsed = handoffActionSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('outcome must be done or failed');
    return guard(() => this.handoff.finish(id, parsed.data.outcome, parsed.data.note?.trim() || undefined));
  }

  @Get('metrics')
  metrics(@Query('days') days?: string, @Query('workflowId') workflowId?: string) {
    const d = Math.min(365, Math.max(1, Number(days) || 30));
    return computeMetrics(this.db, this.skills, { days: d, workflowId: workflowId || undefined });
  }

  @Get('node-types')
  nodeTypes() {
    return NODE_TYPES.map(type => ({ type, ...NODE_TYPE_INFO[type], ports: NODE_PORTS[type], schema: nodeConfigJsonSchema(type) }));
  }

  /** Saves the workflow file. Invalid workflows are refused with the list of problems. */
  @Put('workflows/:id')
  saveWorkflow(@Param('id') id: string, @Body() body: unknown) {
    const parsed = workflowSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException({ message: 'Invalid workflow', problems: parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`) });
    if (parsed.data.id !== id) throw new BadRequestException('The id in the body must match the URL');
    const r = this.engine.workflows.save(parsed.data);
    if (r.problems.length) throw new BadRequestException({ message: 'Fix these problems before saving', problems: r.problems });
    return r;
  }

  /** New workflow, copied from an existing one (default: "default"). */
  @Post('workflows')
  createWorkflow(@Body() body: { id?: string; name?: string; copyFrom?: string }) {
    return guard(async () => {
      const id = String(body?.id ?? '');
      if (!/^[a-z0-9][a-z0-9_-]*$/.test(id)) throw new Error('Workflow id: lowercase letters, digits, - and _');
      if (this.engine.workflows.exists(id)) throw new Error(`Workflow ${id} already exists`);
      const { def } = this.engine.workflows.load(body.copyFrom || 'default');
      const r = this.engine.workflows.save({ ...def, id, name: body.name || `${def.name} (copy)` });
      if (r.problems.length) throw new Error(r.problems.join('; '));
      return { id, ...r };
    });
  }

  /** Routing of a project (`?project=<slug>`; the default project when omitted). */
  @Get('workflow-routing')
  routing(@Query('project') project?: string) {
    return guard(async () => {
      const p = project ? await this.engine.projects.get(project) : (await this.engine.projects.list()).find(x => x.isDefault);
      if (!p) throw new NotFoundException('Project not found');
      return p.settings.routing;
    });
  }

  @Put('workflow-routing')
  saveRouting(@Body() body: unknown, @Query('project') project?: string) {
    const parsed = routingSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; '));
    return guard(async () => {
      for (const id of [parsed.data.default, ...parsed.data.rules.map(x => x.workflow)]) if (!this.engine.workflows.exists(id)) throw new Error(`Workflow ${id} does not exist`);
      const p = project ? await this.engine.projects.get(project) : (await this.engine.projects.list()).find(x => x.isDefault);
      if (!p) throw new NotFoundException('Project not found');
      return (await this.engine.projects.saveRouting(p.id, parsed.data)).settings.routing;
    });
  }

  /**
   * Runs a skill once on a ticket, read-only, to tune it without starting a workflow. Uses the project's repo
   * (read-only tools only) when it is mapped, otherwise an empty folder.
   */
  @Post('skills/:name/try')
  @HttpCode(200)
  trySkill(@Param('name') name: string, @Body() body: unknown) {
    const parsed = trySkillSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues.map(i => i.message).join('; '));
    return guard(async () => {
      const skill = this.skills.get(this.skills.local.pathOf(name));
      const task = await this.tasks.getTask(parsed.data.taskId);
      if (!task) throw new Error('Task not found');
      const repo = repoRegistry.resolve(task)?.path ?? null;
      const cwd = repo ?? mkdtempSync(join(tmpdir(), 'ot-skill-'));
      try {
        const prompt = withSkills(renderTemplate(parsed.data.prompt, { task, artifacts: {}, repoPath: repo, worktreePath: repo }), [skill]);
        const started = Date.now();
        const { text, run } = await askClaude({
          bin: this.config.CLAUDE_BIN, cwd, prompt, timeoutSeconds: 600, model: this.config.PLAYBOOK_MODEL,
          allowedTools: ['Read', 'Grep', 'Glob', 'Bash(git log:*)', 'Bash(git show:*)'],
        });
        return { output: text, costUsd: run.result?.total_cost_usd ?? null, seconds: Math.round((Date.now() - started) / 1000), skillHash: skill.hash, cwd: repo ? 'repo (read-only)' : 'empty folder (no repo mapped)' };
      } finally {
        if (!repo) rmSync(cwd, { recursive: true, force: true });
      }
    });
  }

  @Get('workflows')
  workflows() {
    return this.engine.workflows.list();
  }

  @Get('workflows/:id')
  workflow(@Param('id') id: string) {
    return guard(async () => this.engine.workflows.load(id));
  }

  @Get('workflow-runs')
  runs(@Query('status') status?: string, @Query('project') project?: string): Promise<WorkflowRunList> {
    return this.engine.listRuns(status, project);
  }

  @Get('workflow-runs/:id')
  async run(@Param('id', ParseUUIDPipe) id: string): Promise<WorkflowRunDetail> {
    const r = await this.engine.getRunDetail(id);
    if (!r) throw new NotFoundException();
    return r;
  }

  /** What a step's agent is doing: its tool calls and messages so far. `from` is the `next` of the previous call. */
  @Get('workflow-runs/:id/node-runs/:nodeRunId/log')
  async nodeLog(@Param('id', ParseUUIDPipe) id: string, @Param('nodeRunId', ParseUUIDPipe) nodeRunId: string, @Query('from') from?: string) {
    const nr = await this.db.selectFrom('node_runs').select(['status']).where('id', '=', nodeRunId).where('run_id', '=', id).executeTakeFirst();
    if (!nr) throw new NotFoundException();
    const r = readLiveLog(nodeRunDir(this.config, id, nodeRunId), Math.max(0, Number(from) || 0));
    return { ...r, live: nr.status === 'running' || nr.status === 'queued' };
  }

  @Get('workflow-runs/:id/diff')
  async diff(@Param('id', ParseUUIDPipe) id: string): Promise<RunDiff> {
    const r = await this.engine.getRun(id);
    if (!r) throw new NotFoundException();
    if (!r.worktreePath || !r.baseRef) return { base: null, patch: '', truncated: false };
    return guard(async () => {
      const info = await diffInfo(r.worktreePath!, r.baseRef!);
      return { base: info.base, ...(await diffPatch(r.worktreePath!, info.base)) };
    });
  }

  /** Start the workflow for a task (returns the active run if there is one). */
  @Post('tasks/:taskId/workflow-runs')
  start(@Param('taskId', ParseUUIDPipe) taskId: string, @Body() body: { workflowId?: string }) {
    return guard(() => this.engine.startRun(taskId, 'manual', body?.workflowId || undefined));
  }

  /** Switch a run that has not got past its first step to another workflow (starts a new run). */
  @Post('workflow-runs/:id/workflow')
  @HttpCode(200)
  changeWorkflow(@Param('id', ParseUUIDPipe) id: string, @Body() body: { workflowId?: string }) {
    if (!body?.workflowId) throw new BadRequestException('workflowId is required');
    return guard(() => this.engine.changeWorkflow(id, body.workflowId!));
  }

  @Post('workflow-runs/:id/gate')
  @HttpCode(200)
  async gate(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const parsed = gateActionSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues);
    await guard(() => this.engine.gate(id, parsed.data));
    return { ok: true };
  }

  /** Post the Jira comment / push + open the PR (needs confirm: true and the exact text), or skip. */
  @Post('workflow-runs/:id/confirm')
  @HttpCode(200)
  confirm(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const parsed = confirmActionSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Confirming needs { action: "confirm", confirm: true, text } or { action: "skip" }.');
    return guard(() => this.engine.confirm(id, parsed.data));
  }

    @Post('workflow-runs/:id/evaluate')
  @HttpCode(200)
  async evaluate(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const parsed = evaluateActionSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues);
    await guard(() => this.engine.evaluate(id, parsed.data));
    return { ok: true };
  }

  @Post('workflow-runs/:id/retry')
  @HttpCode(200)
  async retry(@Param('id', ParseUUIDPipe) id: string) {
    await guard(() => this.engine.retry(id));
    return { ok: true };
  }

  /** Run a failed step again, also after the run moved on to the gate that waits for you. */
  @Post('workflow-runs/:id/rerun')
  @HttpCode(200)
  async rerun(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const parsed = rerunNodeActionSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('nodeId is required');
    await guard(() => this.engine.rerunNode(id, parsed.data.nodeId));
    return { ok: true };
  }

  /** Pick the run up again at a step (also a cancelled or finished run), keeping the documents it already made. */
  @Post('workflow-runs/:id/run-from')
  @HttpCode(200)
  async runFrom(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const parsed = runFromActionSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('nodeId is required');
    await guard(() => this.engine.runFrom(id, parsed.data.nodeId));
    return { ok: true };
  }

  @Post('workflow-runs/:id/cancel')
  @HttpCode(200)
  async cancel(@Param('id', ParseUUIDPipe) id: string) {
    await guard(() => this.engine.cancel(id));
    return { ok: true };
  }
}
