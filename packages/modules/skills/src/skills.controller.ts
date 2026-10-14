import { BadRequestException, Body, Controller, Get, Param, Post, Put } from '@nestjs/common';
import { skillFileSchema } from './contracts';
import { LocalSkillStore } from './local-store';

async function guard<T>(fn: () => T | Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof Error && !('status' in e)) throw new BadRequestException(e.message);
    throw e;
  }
}

/** The host's own skills: list, read, create, save. */
@Controller('skills')
export class SkillsController {
  constructor(private readonly skills: LocalSkillStore) {}

  @Get()
  list() {
    return this.skills.list().map(({ body: _b, ...s }) => s);
  }

  @Get(':name')
  read(@Param('name') name: string) {
    return guard(() => this.skills.read(name));
  }

  @Put(':name')
  save(@Param('name') name: string, @Body() body: unknown) {
    const parsed = skillFileSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues.map(i => i.message).join('; '));
    return guard(() => this.skills.save(name, parsed.data.content));
  }

  @Post()
  create(@Body() body: { name?: string; description?: string }) {
    return guard(() => {
      const name = String(body?.name ?? '');
      const content = `---\nname: ${name}\ndescription: ${body?.description?.trim() || 'What this skill does and when to use it.'}\n---\n# ${name}\n\nInstructions for the AI.\n`;
      return this.skills.save(name, content, true);
    });
  }
}
