import { BadRequestException, Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
import { taskQuerySchema, type TaskList } from '@ot/contracts';
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

  @Post('sync')
  @HttpCode(202)
  sync() {
    return this.tasks.syncNow();
  }
}
