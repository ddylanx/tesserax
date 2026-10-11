import { BadRequestException, Controller, Get, HttpCode, NotFoundException, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { taskQuerySchema, type TaskDetailDto, type TaskList } from '@ot/contracts';
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

  @Post('sync')
  @HttpCode(202)
  sync() {
    return this.tasks.syncNow();
  }
}
