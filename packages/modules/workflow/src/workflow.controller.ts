import {
  BadRequestException, Body, ConflictException, Controller, Get, HttpCode, Inject, NotFoundException, Param, ParseUUIDPipe, Post, Put, Query,
} from '@nestjs/common';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AppConfig } from '@ot/config';
import {
  NODE_PORTS, NODE_TYPES, NODE_TYPE_INFO, evaluateActionSchema, gateActionSchema, nodeConfigJsonSchema, skillFileSchema, trySkillSchema,
  workflowSchema, type RunDiff, type WorkflowRunDetail, type WorkflowRunList,
} from '@ot/contracts';
import { CONFIG } from '@ot/core';
import { diffInfo, diffPatch } from '@ot/mod-pipeline';
import { TasksService } from '@ot/mod-tasks';
import { askClaude } from './executors/claude';
import { renderTemplate, withSkills } from './render';
import { RunConflict, WorkflowEngine } from './engine.service';
import { SkillStore } from './stores';

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
    private readonly skills: SkillStore,
    private readonly tasks: TasksService,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

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

  @Get('skills/:name')
  skill(@Param('name') name: string) {
    return guard(async () => this.skills.read(name));
  }

  @Put('skills/:name')
  saveSkill(@Param('name') name: string, @Body() body: unknown) {
    const parsed = skillFileSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues.map(i => i.message).join('; '));
    return guard(async () => this.skills.save(name, parsed.data.content));
  }

  @Post('skills')
  createSkill(@Body() body: { name?: string; description?: string }) {
    return guard(async () => {
      const name = String(body?.name ?? '');
      const content = `---\nname: ${name}\ndescription: ${body?.description?.trim() || 'What this skill does and when to use it.'}\n---\n# ${name}\n\nInstructions for the AI.\n`;
      return this.skills.save(name, content, true);
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
      const skill = this.skills.get(this.skills.pathOf(name));
      const task = await this.tasks.getTask(parsed.data.taskId);
      if (!task) throw new Error('Task not found');
      const repo = this.engine.repos.forProject(task.project);
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

  @Get('skills')
  listSkills() {
    return this.skills.list().map(({ body: _b, ...s }) => s);
  }

  @Get('workflow-runs')
  runs(@Query('status') status?: string): Promise<WorkflowRunList> {
    return this.engine.listRuns(status);
  }

  @Get('workflow-runs/:id')
  async run(@Param('id', ParseUUIDPipe) id: string): Promise<WorkflowRunDetail> {
    const r = await this.engine.getRunDetail(id);
    if (!r) throw new NotFoundException();
    return r;
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
    return guard(() => this.engine.startRun(taskId, 'manual', body?.workflowId || 'default'));
  }

  @Post('workflow-runs/:id/gate')
  @HttpCode(200)
  async gate(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const parsed = gateActionSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues);
    await guard(() => this.engine.gate(id, parsed.data));
    return { ok: true };
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

  @Post('workflow-runs/:id/cancel')
  @HttpCode(200)
  async cancel(@Param('id', ParseUUIDPipe) id: string) {
    await guard(() => this.engine.cancel(id));
    return { ok: true };
  }
}
