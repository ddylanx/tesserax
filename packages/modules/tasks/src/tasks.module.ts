import { Inject, Module, type OnModuleInit } from '@nestjs/common';
import { jiraConfigured, type AppConfig } from '@tesserax/config';
import type { ProjectDirectory } from '@tesserax/contracts';
import { CONFIG, DB, PROJECT_DIRECTORY, SCHEDULES, createLogger, type ScheduleRegistry } from '@tesserax/core';
import type { Db } from '@tesserax/db';
import { JIRA_SYNC_JOB, runJiraSync } from './jobs/jira-sync.job';
import { GITHUB_SYNC_JOB, runGithubSync } from './jobs/github-sync.job';
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
    @Inject(PROJECT_DIRECTORY) private readonly projects: ProjectDirectory,
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
        await this.projects.reassign();
        if (result.inserted.length && !result.firstSync) await this.tasks.notifyNewTasks(result.inserted);
      },
    });

    // GitHub sync: enabled when at least one github source exists (checked at run time).
    this.schedules.register({
      name: GITHUB_SYNC_JOB,
      cron: '*/2 * * * *',
      jitterSeconds: 30,
      runOnStart: true,
      enabled: true, // registered at boot; skips early when no sources exist
      handler: async () => {
        const results = await runGithubSync(this.db, this.config);
        if (!results.length) return;
        await this.projects.reassign();
        for (const result of results) {
          if (result.inserted.length && !result.firstSync) await this.tasks.notifyNewTasks(result.inserted);
        }
      },
    });
  }
}
