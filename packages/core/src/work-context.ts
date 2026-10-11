import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

export interface WorkContextData {
  correlationId: string;
  /** Where the work started: an HTTP request, a job, a bot update. */
  origin?: string;
}

const storage = new AsyncLocalStorage<WorkContextData>();

export const WorkContext = {
  run<T>(data: Partial<WorkContextData>, fn: () => T): T {
    return storage.run({ correlationId: data.correlationId ?? randomUUID(), origin: data.origin }, fn);
  },
  current(): WorkContextData | undefined {
    return storage.getStore();
  },
  correlationId(): string | undefined {
    return storage.getStore()?.correlationId;
  },
};
