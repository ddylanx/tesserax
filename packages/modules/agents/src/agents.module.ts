import { Inject, Module, type OnModuleInit } from '@nestjs/common';
import { DB, QUEUE, SCHEDULES, type Queue, type ScheduleRegistry } from '@ot/core';
import type { Db } from '@ot/db';
import { AgentsController } from './agents.controller';
import { AgentsService } from './agents.service';
import { SWEEP_JOB, runSweepJob } from './jobs/sweep.job';
import { USAGE_JOB, runUsageJob, type UsageJobData } from './jobs/usage.job';

@Module({
  controllers: [AgentsController],
  providers: [AgentsService],
  exports: [AgentsService],
})
export class AgentsModule implements OnModuleInit {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(QUEUE) private readonly queue: Queue,
    @Inject(SCHEDULES) private readonly schedules: ScheduleRegistry,
  ) {}

  onModuleInit() {
    this.queue.work<UsageJobData>(USAGE_JOB, data => runUsageJob(this.db, data), { batchSize: 5 });
    this.schedules.register({ name: SWEEP_JOB, cron: '*/10 * * * *', handler: () => runSweepJob(this.db) });
  }
}
