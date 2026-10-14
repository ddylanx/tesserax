import PgBoss from 'pg-boss';
import { createLogger } from './logger';
import { WorkContext } from './work-context';

const log = createLogger('queue');

/** Every job carries the correlationId of the work that queued it. */
export interface JobEnvelope<T> {
  data: T;
  correlationId?: string;
}

export interface JobMeta {
  id: string;
  name: string;
  /** Retries already used (0 on the first try). */
  retryCount: number;
  retryLimit: number;
}

export type JobHandler<T> = (data: T, meta: JobMeta) => Promise<void>;

export interface WorkerOptions {
  /** Jobs fetched per poll (each is handled one by one). */
  batchSize?: number;
  pollingIntervalSeconds?: number;
}

interface Registration {
  name: string;
  handler: JobHandler<any>;
  options: WorkerOptions;
}

/**
 * Thin wrapper over pg-boss. Handlers can be registered before start(); start() creates
 * queues and begins polling. Keeping registrations module-owned lets workers move to a
 * separate process later without touching handlers.
 */
export class Queue {
  readonly boss: PgBoss;
  private registrations: Registration[] = [];
  private started = false;

  constructor(connectionString: string) {
    this.boss = new PgBoss({ connectionString, schema: 'pgboss', application_name: 'tesserax' });
    this.boss.on('error', err => log.error({ err }, 'pg-boss error'));
  }

  work<T>(name: string, handler: JobHandler<T>, options: WorkerOptions = {}): void {
    if (this.started) throw new Error(`Queue already started; register "${name}" during module init`);
    this.registrations.push({ name, handler, options });
  }

  async send<T>(name: string, data: T, options: PgBoss.SendOptions = {}): Promise<string | null> {
    const envelope: JobEnvelope<T> = { data, correlationId: WorkContext.correlationId() };
    return this.boss.send(name, envelope as object, options);
  }

  /** At most one job per `key` every `seconds`; a call inside the window still gets one run after it. */
  async sendDebounced<T>(name: string, data: T, seconds: number, key: string): Promise<string | null> {
    const envelope: JobEnvelope<T> = { data, correlationId: WorkContext.correlationId() };
    return this.boss.sendDebounced(name, envelope as object, {}, seconds, key);
  }

  async ensureQueue(name: string): Promise<void> {
    const existing = await this.boss.getQueue(name);
    if (!existing) await this.boss.createQueue(name);
  }

  async start(): Promise<void> {
    await this.boss.start();
    for (const reg of this.registrations) {
      await this.ensureQueue(reg.name);
      await this.boss.work<JobEnvelope<unknown>>(
        reg.name,
        { batchSize: reg.options.batchSize ?? 1, pollingIntervalSeconds: reg.options.pollingIntervalSeconds ?? 2, includeMetadata: true },
        async jobs => {
          for (const job of jobs) {
            const env = (job.data ?? {}) as JobEnvelope<unknown>;
            await WorkContext.run({ correlationId: env.correlationId, origin: `job:${job.name}` }, async () => {
              const started = Date.now();
              try {
                await reg.handler(env.data, { id: job.id, name: job.name, retryCount: job.retryCount ?? 0, retryLimit: job.retryLimit ?? 0 });
                log.debug({ jobId: job.id, ms: Date.now() - started }, `job ${job.name} done`);
              } catch (err) {
                log.error({ err, jobId: job.id }, `job ${job.name} failed`);
                throw err;
              }
            });
          }
        },
      );
    }
    this.started = true;
    log.info({ queues: this.registrations.map(r => r.name) }, 'queue workers started');
  }

  async stop(): Promise<void> {
    await this.boss.stop({ graceful: true, timeout: 5000 });
  }
}
