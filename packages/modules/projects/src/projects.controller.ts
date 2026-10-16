import { BadRequestException, Body, Controller, Delete, Get, HttpCode, NotFoundException, Param, Post, Put } from '@nestjs/common';
import { saveProjectSchema, type Project, type ProjectCard } from '@tesserax/contracts';
import { ProjectsService } from './projects.service';

const bad = (issues: { path: PropertyKey[]; message: string }[]) => new BadRequestException(issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; '));

@Controller('projects')
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  @Get()
  async list(): Promise<{ projects: ProjectCard[] }> {
    return { projects: await this.projects.cards() };
  }

  @Get(':slug')
  async one(@Param('slug') slug: string): Promise<Project> {
    const p = await this.projects.get(slug);
    if (!p) throw new NotFoundException();
    return p;
  }

  @Post()
  async create(@Body() body: unknown): Promise<Project> {
    const parsed = saveProjectSchema.safeParse(body);
    if (!parsed.success) throw bad(parsed.error.issues);
    return this.projects.create(parsed.data);
  }

  @Put(':slug')
  async save(@Param('slug') slug: string, @Body() body: unknown): Promise<Project> {
    const parsed = saveProjectSchema.omit({ slug: true }).safeParse(body);
    if (!parsed.success) throw bad(parsed.error.issues);
    return this.projects.save(slug, parsed.data);
  }

  @Delete(':slug')
  @HttpCode(200)
  async remove(@Param('slug') slug: string) {
    await this.projects.remove(slug);
    return { ok: true };
  }
}
