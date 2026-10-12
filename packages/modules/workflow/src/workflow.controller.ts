import {
  BadRequestException, Body, ConflictException, Controller, Get, HttpCode, NotFoundException, Param, ParseUUIDPipe, Post, Query,
} from '@nestjs/common';
import { evaluateActionSchema, gateActionSchema, type RunDiff, type WorkflowRunDetail, type WorkflowRunList } from '@ot/contracts';
import { diffInfo, diffPatch } from '@ot/mod-pipeline';
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
  constructor(private readonly engine: WorkflowEngine, private readonly skills: SkillStore) {}

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
