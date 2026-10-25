import PgBoss from 'pg-boss';
import { Client } from 'pg';
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

// Any fixed number: whoever holds this session lock on the database runs the job workers.
const WORKER_LOCK = 7_130_424;
const LOCK_RETRY_MS = 30_000;

/**
 * Thin wrapper over pg-boss. Handlers can be registered before start(); start() creates
 * queues and begins polling. Keeping registrations module-owned lets workers move to a
 * separate process later without touching handlers.
 */
export class Queue {
  readonly boss: PgBoss;
  private registrations: Registration[] = [];
  private started = false;
  private lock?: Client;
  private retry?: NodeJS.Timeout;
  private stopping = false;

  constructor(private readonly connectionString: string) {
    // Few connections: a hosted Postgres (Supabase session pooler) allows only ~15 per project.
    this.boss = new PgBoss({ connectionString, schema: 'pgboss', application_name: 'tesserax', max: 3 });
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

  /**
   * True while this process runs the job workers. With one database shared by several machines,
   * only the one holding the worker lock does; the others still serve the API and queue jobs.
   */
  get isWorker(): boolean {
    return this.lock !== undefined;
  }

  async start(): Promise<void> {
    await this.boss.start();
    // Every process sends jobs, and pg-boss refuses to send to a queue that does not exist yet.
    for (const reg of this.registrations) await this.ensureQueue(reg.name);
    this.started = true;
    await this.claimWorkers();
  }

  private async claimWorkers(): Promise<void> {
    if (this.stopping || this.lock) return;
    if (!(await this.tryLock())) {
      if (!this.retry) log.warn('another machine runs the job workers on this database; this one only serves the API (retrying every 30 s)');
      this.retry ??= setInterval(() => void this.claimWorkers().catch(err => log.warn({ err }, 'worker lock retry failed')), LOCK_RETRY_MS);
      this.retry.unref();
      return;
    }
    clearInterval(this.retry);
    this.retry = undefined;
    await this.startWorkers();
  }

  private async tryLock(): Promise<boolean> {
    const client = new Client({ connectionString: this.connectionString, application_name: 'tesserax-worker-lock', keepAlive: true });
    try {
      await client.connect();
      const { rows } = await client.query<{ ok: boolean }>('select pg_try_advisory_lock($1) as ok', [WORKER_LOCK]);
      if (!rows[0]?.ok) {
        await client.end();
        return false;
      }
    } catch (err) {
      await client.end().catch(() => undefined);
      throw err;
    }
    // Losing the connection (sleep, network) releases the lock server-side, so another machine may take over:
    // stop working here and try to win it back.
    const lost = (err?: Error) => {
      if (this.lock !== client) return;
      this.lock = undefined;
      if (this.stopping) return;
      log.warn({ err: err?.message }, 'worker lock connection lost; pausing job workers');
      void this.stopWorkers().then(() => this.claimWorkers()).catch(e => log.warn({ err: e }, 'could not reclaim worker lock'));
    };
    client.on('error', lost);
    client.on('end', () => lost());
    this.lock = client;
    return true;
  }

  private async startWorkers(): Promise<void> {
    for (const reg of this.registrations) {
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
    log.info({ queues: this.registrations.map(r => r.name) }, 'queue workers started');
  }

  private async stopWorkers(): Promise<void> {
    for (const reg of this.registrations) await this.boss.offWork(reg.name).catch(() => undefined);
  }

  async stop(): Promise<void> {
    this.stopping = true;
    clearInterval(this.retry);
    await this.boss.stop({ graceful: true, timeout: 5000 });
    await this.lock?.end().catch(() => undefined);
  }
}
