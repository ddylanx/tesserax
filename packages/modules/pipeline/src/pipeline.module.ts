import { Module, type OnModuleInit, Inject } from '@nestjs/common';
import { QUEUE, createLogger, type Queue } from '@ot/core';
import { TasksModule, TasksService } from '@ot/mod-tasks';
import { ClassificationService } from './classify/classification.service';
import { runClassifyJob } from './jobs/classify.job';
import { PipelineController } from './pipeline.controller';
import { PipelineService } from './pipeline.service';
import { PlaybookRegistry } from './playbooks';
import { STEPS, type StepJobData } from './states';

const log = createLogger('pipeline');

@Module({
  imports: [TasksModule],
  controllers: [PipelineController],
  providers: [PipelineService, ClassificationService, { provide: PlaybookRegistry, useFactory: () => new PlaybookRegistry() }],
  exports: [PipelineService],
})
export class PipelineModule implements OnModuleInit {
  constructor(
    @Inject(QUEUE) private readonly queue: Queue,
    private readonly pipeline: PipelineService,
    private readonly tasks: TasksService,
    private readonly classifier: ClassificationService,
    private readonly playbooks: PlaybookRegistry,
  ) {}

  onModuleInit() {
    this.queue.work<StepJobData>(STEPS.classify.queue, (data, meta) =>
      runClassifyJob({ pipeline: this.pipeline, tasks: this.tasks, classifier: this.classifier, playbooks: this.playbooks }, data, meta),
    );

    // New Jira issues (not the first import of a source) start a run.
    this.tasks.onNewTasks(async taskIds => {
      for (const id of taskIds) {
        const task = await this.tasks.getTask(id);
        if (!task || task.statusCategory === 'done') continue;
        const { created } = await this.pipeline.createRun(id, 'new_issue');
        if (created) log.info({ key: task.key }, 'pipeline run created for new issue');
      }
    });
  }
}
