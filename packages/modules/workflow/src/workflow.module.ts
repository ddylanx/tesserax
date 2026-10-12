import { Inject, Module, type OnApplicationBootstrap, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import type { AppConfig } from '@ot/config';
import { CONFIG, DB, QUEUE, SCHEDULES, createLogger, type Queue, type ScheduleRegistry } from '@ot/core';
import type { Db } from '@ot/db';
import { TasksModule, TasksService } from '@ot/mod-tasks';
import { FINALIZE_QUEUE, NODE_QUEUE, WorkflowEngine } from './engine.service';
import { finalizeAgentJob, runNodeJob, scanAgentNodes, type JobDeps } from './jobs';
import { SkillStore } from './stores';
import { WorkflowController } from './workflow.controller';

const log = createLogger('workflow');

@Module({
  imports: [TasksModule],
  controllers: [WorkflowController],
  providers: [WorkflowEngine, { provide: SkillStore, useFactory: () => new SkillStore() }],
  exports: [WorkflowEngine],
})
export class WorkflowModule implements OnModuleInit, OnApplicationBootstrap, OnModuleDestroy {
  private watcher?: NodeJS.Timeout;
  private deps!: JobDeps;

  constructor(
    @Inject(CONFIG) private readonly config: AppConfig,
    @Inject(DB) private readonly db: Db,
    @Inject(QUEUE) private readonly queue: Queue,
    @Inject(SCHEDULES) private readonly schedules: ScheduleRegistry,
    private readonly engine: WorkflowEngine,
    private readonly tasks: TasksService,
    private readonly skills: SkillStore,
  ) {}

  onModuleInit() {
    this.deps = { db: this.db, engine: this.engine, tasks: this.tasks, skills: this.skills, config: this.config, queue: this.queue };
    this.queue.work<{ nodeRunId: string }>(NODE_QUEUE, (data, meta) => runNodeJob(this.deps, data, meta), { batchSize: 2 });
    this.queue.work<{ nodeRunId: string; timedOut?: boolean }>(FINALIZE_QUEUE, data => finalizeAgentJob(this.deps, data));
    this.schedules.register({ name: 'wf.watch', cron: '* * * * *', handler: () => scanAgentNodes(this.deps) });

    if (this.config.AUTO_START === 'workflow') {
      // New Jira issues (not the first import of a source) start the default workflow.
      this.tasks.onNewTasks(async ids => {
        for (const id of ids) {
          const task = await this.tasks.getTask(id);
          if (!task || task.statusCategory === 'done') continue;
          const { created } = await this.engine.startRun(id, 'new_issue').catch(err => {
            log.warn({ err: (err as Error).message, key: task.key }, 'could not start workflow');
            return { created: false };
          });
          if (created) log.info({ key: task.key }, 'workflow started for new issue');
        }
      });
    }
  }

  onApplicationBootstrap() {
    this.watcher = setInterval(() => scanAgentNodes(this.deps).catch(err => log.warn({ err }, 'agent scan failed')), 5000);
    this.watcher.unref();
  }

  onModuleDestroy() {
    clearInterval(this.watcher);
  }
}
