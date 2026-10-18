import { Inject, Module, type OnModuleInit } from '@nestjs/common';
import { jiraConfigured, type AppConfig } from '@tesserax/config';
import type { ProjectDirectory } from '@tesserax/contracts';
import { CONFIG, DB, PROJECT_DIRECTORY, SCHEDULES, TASK_SOURCES, createLogger, type ScheduleRegistry } from '@tesserax/core';
import type { Db } from '@tesserax/db';
import { JIRA_SYNC_JOB } from './jobs/jira-sync.job';
import { JiraTaskSource } from './jira/jira-task-source';
import { TaskSourceRegistry } from './task-source.registry';
import { TasksController } from './tasks.controller';
import { TasksService } from './tasks.service';

const log = createLogger('tasks');

@Module({
  controllers: [TasksController],
  providers: [
    JiraTaskSource,
    {
      provide: TASK_SOURCES,
      useFactory: (jira: JiraTaskSource) => [jira],
      inject: [JiraTaskSource],
    },
    TaskSourceRegistry,
    TasksService,
  ],
  exports: [TasksService, TaskSourceRegistry],
})
export class TasksModule implements OnModuleInit {
  constructor(
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
        await this.tasks.syncAll();
      },
    });
  }
}
