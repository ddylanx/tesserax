import { Inject, Module, type OnApplicationBootstrap, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import type { AppConfig } from '@ot/config';
import { CONFIG, DB, QUEUE, SCHEDULES, createLogger, type Queue, type ScheduleRegistry } from '@ot/core';
import type { Db } from '@ot/db';
import { TasksModule, TasksService } from '@ot/mod-tasks';
import { ClassificationService, ClassifyModule } from '@ot/mod-classify';
import { runClassifyJob } from './jobs/classify.job';
import { runFinalizeJob, scanRunningPlaybooks } from './jobs/finalize.job';
import { runPlaybookJob } from './jobs/run-playbook.job';
import { PipelineController } from './pipeline.controller';
import { PipelineService } from './pipeline.service';
import { PlaybookRegistry } from './playbooks';
import { STEPS, type StepJobData } from './states';

const log = createLogger('pipeline');

@Module({
  imports: [TasksModule, ClassifyModule],
  controllers: [PipelineController],
  providers: [PipelineService, { provide: PlaybookRegistry, useFactory: () => new PlaybookRegistry() }],
  exports: [PipelineService],
})
export class PipelineModule implements OnModuleInit, OnApplicationBootstrap, OnModuleDestroy {
  private watcher?: NodeJS.Timeout;

  constructor(
    @Inject(CONFIG) private readonly config: AppConfig,
    @Inject(QUEUE) private readonly queue: Queue,
    @Inject(DB) private readonly db: Db,
    @Inject(SCHEDULES) private readonly schedules: ScheduleRegistry,
    private readonly pipeline: PipelineService,
    private readonly tasks: TasksService,
    private readonly classifier: ClassificationService,
    private readonly playbooks: PlaybookRegistry,
  ) {}

  onModuleInit() {
    this.queue.work<StepJobData>(STEPS.classify.queue, (data, meta) =>
      runClassifyJob({ pipeline: this.pipeline, tasks: this.tasks, classifier: this.classifier, playbooks: this.playbooks }, data, meta),
    );

    const deps = { pipeline: this.pipeline, tasks: this.tasks, playbooks: this.playbooks, config: this.config };
    this.queue.work<StepJobData>(STEPS.run.queue, (data, meta) => runPlaybookJob(deps, data, meta));
    this.queue.work<StepJobData>(STEPS.finalize.queue, (data, meta) => runFinalizeJob(deps, data, meta));
    // Backup scan through pg-boss (keeps working if the in-process watcher moves to a separate worker later).
    this.schedules.register({ name: 'pipeline.watch', cron: '* * * * *', handler: () => scanRunningPlaybooks(this.db, this.queue, this.config) });

    // New Jira issues (not the first import of a source) start a run, when AUTO_START=pipeline.
    if (this.config.AUTO_START === 'pipeline') this.tasks.onNewTasks(async taskIds => {
      for (const id of taskIds) {
        const task = await this.tasks.getTask(id);
        if (!task || task.statusCategory === 'done') continue;
        const { created } = await this.pipeline.createRun(id, 'new_issue');
        if (created) log.info({ key: task.key }, 'pipeline run created for new issue');
      }
    });
  }

  /** Fast pickup of finished agent runs: file checks every 5 s, the work itself goes through pg-boss jobs. */
  onApplicationBootstrap() {
    this.watcher = setInterval(() => {
      scanRunningPlaybooks(this.db, this.queue, this.config).catch(err => log.warn({ err }, 'watch scan failed'));
    }, 5000);
    this.watcher.unref();
  }

  onModuleDestroy() {
    clearInterval(this.watcher);
  }
}
