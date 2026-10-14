import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Inject, Logger, Param, Patch, Post, Query } from '@nestjs/common';
import { installSkillPackageSchema, patchSkillPackageSchema, type PackageSkill, type SkillPackageList } from './contracts';
import { SKILLS_OPTIONS, type SkillsLogger, type SkillsModuleOptions } from './options';
import { SkillPackageStore } from './package-store';

async function guard<T>(fn: () => T | Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof Error && !('status' in e)) throw new BadRequestException(e.message);
    throw e;
  }
}

/** External skill packages (git repos with SKILL.md files): install, list by category, update, remove. */
@Controller('skill-packages')
export class SkillPackagesController {
  // Installs and updates touch the same folder; one at a time.
  private busy: Promise<unknown> = Promise.resolve();
  private readonly log: SkillsLogger;

  constructor(private readonly store: SkillPackageStore, @Inject(SKILLS_OPTIONS) opts: SkillsModuleOptions) {
    const nest = new Logger('skills');
    this.log = opts.logger ?? { info: (obj, msg) => nest.log(`${msg} ${JSON.stringify(obj)}`) };
  }

  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.busy.then(fn, fn);
    this.busy = next.catch(() => undefined);
    return next;
  }

  @Get()
  list(): SkillPackageList {
    return this.store.list();
  }

  /** Same shape as GET /api/skills, so workflow nodes can pick package skills by path. */
  @Get('skills')
  skills(): PackageSkill[] {
    return this.store.skills();
  }

  @Get(':id/skills/:skill')
  skill(@Param('id') id: string, @Param('skill') skill: string) {
    return guard(() => this.store.skillContent(id, skill));
  }

  @Post()
  install(@Body() body: unknown) {
    const parsed = installSkillPackageSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; '));
    return guard(() => this.serial(async () => {
      const p = await this.store.install(parsed.data);
      this.log.info({ id: p.id, source: p.source, commit: p.commit, skills: p.skills }, 'skill package installed');
      return p;
    }));
  }

  @Post(':id/update')
  @HttpCode(200)
  update(@Param('id') id: string) {
    return guard(() => this.serial(async () => {
      const p = await this.store.update(id);
      this.log.info({ id, commit: p.commit, changed: p.changed }, 'skill package updated');
      return p;
    }));
  }

  @Patch(':id')
  patch(@Param('id') id: string, @Body() body: unknown) {
    const parsed = patchSkillPackageSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Needs { category }: lowercase letters, digits and dashes.');
    return guard(() => this.store.setCategory(id, parsed.data.category));
  }

  @Delete(':id')
  remove(@Param('id') id: string, @Query('force') force?: string) {
    return guard(() => this.serial(async () => {
      const r = this.store.remove(id, force === '1');
      this.log.info({ id, usedBy: r.usedBy }, 'skill package removed');
      return r;
    }));
  }
}
