import { Inject, Module, type OnModuleInit } from '@nestjs/common';
import { jiraConfigured, type AppConfig } from '@tesserax/config';
import { CONFIG, DB, SCHEDULES, createLogger, type ScheduleRegistry } from '@tesserax/core';
import type { Db } from '@tesserax/db';
import { JIRA_SYNC_JOB, runJiraSync } from './jobs/jira-sync.job';
import { TasksController } from './tasks.controller';
import { TasksService } from './tasks.service';

const log = createLogger('tasks');

@Module({
  controllers: [TasksController],
  providers: [TasksService],
  exports: [TasksService],
})
export class TasksModule implements OnModuleInit {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(CONFIG) private readonly config: AppConfig,
    @Inject(SCHEDULES) private readonly schedules: ScheduleRegistry,
    private readonly tasks: TasksService,
  ) {}

  onModuleInit() {
    const enabled = jiraConfigured(this.config);
    if (!enabled) log.info('Jira not configured (JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN); sync off');
    this.schedules.register({
      name: JIRA_SYNC_JOB,
      cron: '*/2 * * * *',
      jitterSeconds: 30,
      runOnStart: true,
      enabled,
      handler: async () => {
        const result = await runJiraSync(this.db, this.config);
        if (result.inserted.length && !result.firstSync) await this.tasks.notifyNewTasks(result.inserted);
      },
    });
  }
}
