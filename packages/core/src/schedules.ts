import type { Queue } from './queue';
import { createLogger } from './logger';

const log = createLogger('schedules');

export interface ScheduleDefinition<T = unknown> {
  /** Also the queue name. */
  name: string;
  cron: string;
  data?: T;
  /** Run once right after start, too (useful for syncs). */
  runOnStart?: boolean;
  /** Random delay (seconds) before the handler runs, so syncs do not hit APIs in lockstep. */
  jitterSeconds?: number;
  handler: (data: T) => Promise<void>;
  /** When false the schedule is removed (e.g. missing credentials). */
  enabled?: boolean;
}

export interface ScheduleInfo {
  name: string;
  cron: string;
  enabled: boolean;
  jitterSeconds: number;
}

/** Modules declare cron jobs here during init; start() syncs them into pg-boss. */
export class ScheduleRegistry {
  private defs: ScheduleDefinition<any>[] = [];

  constructor(private readonly queue: Queue) {}

  register<T>(def: ScheduleDefinition<T>): void {
    this.defs.push(def);
    const jitter = def.jitterSeconds ?? 0;
    this.queue.work<T>(def.name, async data => {
      if (jitter > 0) await new Promise(r => setTimeout(r, Math.random() * jitter * 1000));
      await def.handler(data ?? (def.data as T));
    });
  }

  list(): ScheduleInfo[] {
    return this.defs.map(d => ({ name: d.name, cron: d.cron, enabled: d.enabled !== false, jitterSeconds: d.jitterSeconds ?? 0 }));
  }

  /** Call after queue.start(). */
  async start(): Promise<void> {
    const boss = this.queue.boss;
    const known = new Set(this.defs.map(d => d.name));
    for (const existing of await boss.getSchedules()) {
      if (!known.has(existing.name)) await boss.unschedule(existing.name);
    }
    for (const def of this.defs) {
      if (def.enabled === false) {
        await boss.unschedule(def.name);
        log.info(`schedule ${def.name} disabled`);
        continue;
      }
      await boss.schedule(def.name, def.cron, { data: def.data ?? {} }, { tz: 'UTC' });
      if (def.runOnStart) await this.queue.send(def.name, def.data ?? {}, { singletonKey: `${def.name}:startup`, singletonSeconds: 60 });
      log.info(`schedule ${def.name} ${def.cron}`);
    }
  }
}
