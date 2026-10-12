import { Global, Inject, Module, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { loadConfig, type AppConfig } from '@ot/config';
import { CONFIG, DB, QUEUE, SCHEDULES, Queue, ScheduleRegistry, createLogger } from '@ot/core';
import { sql } from 'kysely';
import { createDb, migrateToLatest, seed, type Db } from '@ot/db';

const log = createLogger('infra');

/**
 * Shared infrastructure for every module: config, Kysely, pg-boss queue and schedules.
 * Local mode: migrations + seed run at boot, and this process also runs the job workers.
 */
@Global()
@Module({
  providers: [
    { provide: CONFIG, useFactory: () => loadConfig() },
    {
      provide: DB,
      inject: [CONFIG],
      useFactory: async (config: AppConfig) => {
        const db = createDb(config.DATABASE_URL);
        // Docker may still be starting Postgres (e.g. right after login): wait instead of crashing.
        for (let i = 1; ; i++) {
          try {
            await sql`select 1`.execute(db);
            break;
          } catch (err) {
            if (i >= 60) throw err;
            if (i === 1 || i % 10 === 0) log.warn(`waiting for Postgres at ${new URL(config.DATABASE_URL).host} (${(err as Error).message})`);
            await new Promise(r => setTimeout(r, 1000));
          }
        }
        const { results } = await migrateToLatest(db);
        for (const r of results ?? []) log.info(`migration ${r.migrationName}: ${r.status}`);
        await seed(db);
        return db;
      },
    },
    { provide: QUEUE, inject: [CONFIG], useFactory: (config: AppConfig) => new Queue(config.DATABASE_URL) },
    { provide: SCHEDULES, inject: [QUEUE], useFactory: (queue: Queue) => new ScheduleRegistry(queue) },
  ],
  exports: [CONFIG, DB, QUEUE, SCHEDULES],
})
export class InfraModule implements OnApplicationBootstrap, OnApplicationShutdown {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(QUEUE) private readonly queue: Queue,
    @Inject(SCHEDULES) private readonly schedules: ScheduleRegistry,
  ) {}

  // Runs after every module's onModuleInit, so all handlers and schedules are registered by now.
  async onApplicationBootstrap() {
    await this.queue.start();
    await this.schedules.start();
  }

  async onApplicationShutdown() {
    await this.queue.stop().catch(() => undefined);
    await this.db.destroy();
  }
}
