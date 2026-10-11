import {
  BadRequestException, Body, ConflictException, Controller, Get, HttpCode, NotFoundException, Param, ParseUUIDPipe, Post, Put, Query,
} from '@nestjs/common';
import { decisionSchema, postCommentSchema, verifySchema, type FeedbackStats, type PipelineList, type PipelineRunDetail, type PlaybookDto, type RepoMap, type RunDiff } from '@ot/contracts';
import { TasksService } from '@ot/mod-tasks';
import { PipelineService } from './pipeline.service';
import { PlaybookRegistry } from './playbooks';
import { diffPatch } from './agent/git';
import { checkRepoPath } from './repo-map';
import { TransitionConflict } from './states';

/** Maps state-machine conflicts to 409 so the UI can refresh and show the current state. */
async function guard<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof TransitionConflict) {
      if (!e.actual) throw new NotFoundException('Run not found');
      throw new ConflictException(e.message);
    }
    throw e;
  }
}

export const branchFor = (key: string | null, runId: string) => `ot/${(key ?? runId.slice(0, 8)).replace(/[^A-Za-z0-9._-]+/g, '-')}`;

@Controller('pipeline')
export class PipelineController {
  constructor(
    private readonly pipeline: PipelineService,
    private readonly tasks: TasksService,
    private readonly playbooks: PlaybookRegistry,
  ) {}

  @Get('runs')
  list(@Query('group') group?: string): Promise<PipelineList> {
    return this.pipeline.listRuns(group);
  }

  @Get('runs/:id')
  async one(@Param('id', ParseUUIDPipe) id: string): Promise<PipelineRunDetail> {
    const r = await this.pipeline.getRunDetail(id);
    if (!r) throw new NotFoundException();
    return r;
  }

  /** "Run pipeline" on a task. Returns the existing active run instead of creating a second one. */
  @Post('tasks/:taskId/runs')
  async create(@Param('taskId', ParseUUIDPipe) taskId: string) {
    if (!(await this.tasks.getTask(taskId))) throw new NotFoundException('Task not found');
    return this.pipeline.createRun(taskId, 'manual');
  }

  @Post('runs/:id/decide')
  @HttpCode(200)
  async decide(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const parsed = decisionSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues);
    const d = parsed.data;
    if (!this.playbooks.get(d.playbookId)) throw new BadRequestException(`Unknown playbook ${d.playbookId}`);
    const run = await this.pipeline.getRun(id);
    if (!run) throw new NotFoundException();
    let repoPath = d.repoPath ?? this.pipeline.repos.forProject(run.task.project);
    if (!repoPath) {
      throw new BadRequestException(
        `No local repo is mapped for project ${run.task.project ?? '(none)'}. Enter the repo path (it is saved to config/repos.json).`,
      );
    }
    try {
      repoPath = checkRepoPath(repoPath);
    } catch (e) {
      throw new BadRequestException((e as Error).message);
    }
    if (d.repoPath && run.task.project) this.pipeline.repos.set(run.task.project, repoPath);
    await guard(() => this.pipeline.decide(id, d, repoPath!, branchFor(run.task.key, id)));
    return { ok: true };
  }

  @Post('runs/:id/reject')
  @HttpCode(200)
  async reject(@Param('id', ParseUUIDPipe) id: string, @Body() body: { note?: string }) {
    await guard(() => this.pipeline.reject(id, typeof body?.note === 'string' ? body.note.slice(0, 2000) : undefined));
    return { ok: true };
  }

  @Post('runs/:id/reclassify')
  @HttpCode(200)
  async reclassify(@Param('id', ParseUUIDPipe) id: string) {
    await guard(() => this.pipeline.reclassify(id));
    return { ok: true };
  }

  @Post('runs/:id/retry')
  @HttpCode(200)
  async retry(@Param('id', ParseUUIDPipe) id: string) {
    await guard(() => this.pipeline.retry(id));
    return { ok: true };
  }

  @Post('runs/:id/rerun')
  @HttpCode(200)
  async rerun(@Param('id', ParseUUIDPipe) id: string) {
    await guard(() => this.pipeline.rerun(id));
    return { ok: true };
  }

  @Post('runs/:id/cancel')
  @HttpCode(200)
  async cancel(@Param('id', ParseUUIDPipe) id: string) {
    await guard(() => this.pipeline.cancel(id));
    return { ok: true };
  }

  @Post('runs/:id/verify')
  @HttpCode(200)
  async verify(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const parsed = verifySchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues);
    await guard(() => this.pipeline.verify(id, parsed.data.outcome, parsed.data.note?.trim() || undefined));
    return { ok: true };
  }

  @Get('runs/:id/diff')
  async diff(@Param('id', ParseUUIDPipe) id: string): Promise<RunDiff> {
    const run = await this.pipeline.getRun(id);
    if (!run) throw new NotFoundException();
    const base = (run.result as { base?: string | null } | null)?.base ?? null;
    if (!run.worktreePath || !base) return { base, patch: '', truncated: false };
    try {
      return { base, ...(await diffPatch(run.worktreePath, base)) };
    } catch (e) {
      throw new BadRequestException(`Could not read the worktree diff: ${(e as Error).message}`);
    }
  }

  /** Posts a comment on the Jira issue. Requires confirm: true, sent only by the confirmation dialog. */
  @Post('runs/:id/jira-comment')
  @HttpCode(200)
  async jiraComment(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const parsed = postCommentSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Posting to Jira needs the comment text and an explicit confirmation.');
    try {
      return await guard(() => this.pipeline.postJiraComment(id, parsed.data.text));
    } catch (e) {
      if (e instanceof Error && !(e instanceof ConflictException) && !(e instanceof NotFoundException)) throw new BadRequestException(e.message);
      throw e;
    }
  }

  @Get('feedback')
  feedback(): Promise<FeedbackStats> {
    return this.pipeline.feedbackStats();
  }

  @Get('playbooks')
  listPlaybooks(): PlaybookDto[] {
    return this.playbooks.list().map(({ template: _t, file: _f, maxBudgetUsd: _b, ...p }) => p);
  }

  @Get('repos')
  repos(): RepoMap {
    return this.pipeline.repos.read();
  }

  @Put('repos/:project')
  setRepo(@Param('project') project: string, @Body() body: { path?: string }) {
    if (!/^[A-Z][A-Z0-9_]*$/.test(project)) throw new BadRequestException('Project key like PAY');
    try {
      return this.pipeline.repos.set(project, String(body?.path ?? ''));
    } catch (e) {
      throw new BadRequestException((e as Error).message);
    }
  }
}
