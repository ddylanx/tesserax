import { BadRequestException, Body, Controller, Delete, Get, HttpCode, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { createLocalTaskSchema, setTaskWorkplaceSchema, taskQuerySchema, updateLocalTaskSchema, type TaskDetailDto, type TaskList } from '@ot/contracts';
import { TasksService } from './tasks.service';

@Controller('tasks')
export class TasksController {
  constructor(private readonly tasks: TasksService) {}

  @Get()
  list(@Query() query: Record<string, string>): Promise<TaskList> {
    const parsed = taskQuerySchema.safeParse(query);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues);
    return this.tasks.list(parsed.data);
  }

  @Get(':id')
  async one(@Param('id', ParseUUIDPipe) id: string): Promise<TaskDetailDto> {
    const t = await this.tasks.getTask(id);
    if (!t) throw new NotFoundException();
    return t;
  }

  /** "New task": a local task in the Company or Personal workspace. */
  @Post()
  async create(@Body() body: unknown): Promise<TaskDetailDto> {
    const parsed = createLocalTaskSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; '));
    return this.tasks.createLocal(parsed.data);
  }

  @Patch(':id')
  async update(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown): Promise<TaskDetailDto> {
    const parsed = updateLocalTaskSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; '));
    return this.tasks.updateLocal(id, parsed.data).catch(e => {
      throw new BadRequestException((e as Error).message);
    });
  }

  /** Pick the workplace (Repos page) this task's workflow works in; null = by project. Works for Jira tasks too. */
  @Patch(':id/workplace')
  async setWorkplace(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown): Promise<TaskDetailDto> {
    const parsed = setTaskWorkplaceSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues.map(i => i.message).join('; '));
    return this.tasks.setWorkplace(id, parsed.data.workplaceId).catch(e => {
      throw new BadRequestException((e as Error).message);
    });
  }

  @Delete(':id')
  @HttpCode(200)
  async remove(@Param('id', ParseUUIDPipe) id: string) {
    await this.tasks.deleteLocal(id).catch(e => {
      throw new BadRequestException((e as Error).message);
    });
    return { ok: true };
  }

  @Post('sync')
  @HttpCode(202)
  sync() {
    return this.tasks.syncNow();
  }
}
