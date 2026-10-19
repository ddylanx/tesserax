import { BadRequestException, Body, Controller, Delete, Get, Inject, Optional, Param, Post, Put } from '@nestjs/common';
import type { DemoRepoResponse, ProjectDirectory, RepoInspection, RepoRegistryView } from '@tesserax/contracts';
import { DB, PROJECT_DIRECTORY } from '@tesserax/core';
import { sql, type Kysely } from 'kysely';
import { RepoRegistryStore } from './store';

const bad = (fn: () => unknown) => {
  try {
    return fn();
  } catch (e) {
    const err = e as { issues?: { path: (string | number)[]; message: string }[]; message: string };
    throw new BadRequestException(err.issues ? err.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ') : err.message);
  }
};

/** Repos page: repositories, their workplaces (one local checkout per brand) and what is on disk. */
@Controller('repos')
export class ReposController {
  constructor(
    private readonly store: RepoRegistryStore,
    @Inject(DB) private readonly db: Kysely<any>,
    @Optional() @Inject(PROJECT_DIRECTORY) private readonly projects?: ProjectDirectory,
  ) {}

  @Post('demo')
  async createDemo(): Promise<DemoRepoResponse> {
    const res = bad(() => this.store.createDemoRepo()) as DemoRepoResponse;
    if (this.projects) {
      await this.projects.addWorkplaceToDefault(res.workplace.id);
    }
    return res;
  }

  @Get()
  async view(): Promise<RepoRegistryView> {
    const reg = bad(() => this.store.read()) as ReturnType<RepoRegistryStore['read']>;
    const projects = await this.db
      .selectFrom('tasks')
      .select(sql<string>`distinct project`.as('project'))
      .where('project', 'is not', null)
      .execute()
      .then(rows => rows.map(r => r.project).filter(Boolean).sort())
      .catch(() => [] as string[]);
    return {
      file: this.store.file,
      repositories: reg.repositories,
      workplaces: reg.workplaces.map(w => ({ ...w, status: this.store.status(w, reg.repositories.find(r => r.id === w.repositoryId)) })),
      projects: [...new Set([...projects, ...reg.workplaces.flatMap(w => w.projects)])].sort(),
    };
  }

  @Post('inspect')
  inspect(@Body() body: { path?: string }): RepoInspection {
    return bad(() => this.store.inspect(String(body?.path ?? ''))) as RepoInspection;
  }

  @Put('repositories/:id')
  saveRepository(@Param('id') id: string, @Body() body: Record<string, unknown>) {
    return bad(() => this.store.saveRepository({ ...body, id }));
  }

  @Delete('repositories/:id')
  deleteRepository(@Param('id') id: string) {
    return bad(() => this.store.deleteRepository(id));
  }

  @Put('workplaces/:id')
  saveWorkplace(@Param('id') id: string, @Body() body: Record<string, unknown>) {
    return bad(() => this.store.saveWorkplace({ ...body, id }));
  }

  @Delete('workplaces/:id')
  async deleteWorkplace(@Param('id') id: string) {
    const n = await this.db.selectFrom('tasks').select(sql<number>`count(*)::int`.as('n')).where('workplace_id', '=', id).executeTakeFirst();
    if (n && Number(n.n) > 0) throw new BadRequestException(`${n.n} task(s) use this workplace; pick another one on them first.`);
    return bad(() => this.store.deleteWorkplace(id));
  }
}
