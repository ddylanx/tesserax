import pino, { type Logger } from 'pino';
import { loadConfig } from '@tesserax/config';
import { WorkContext } from './work-context';

let root: Logger | undefined;

/** Root pino logger; every line carries the current correlationId (from WorkContext) when there is one. */
export function rootLogger(): Logger {
  if (root) return root;
  const config = loadConfig();
  root = pino({
    level: config.LOG_LEVEL,
    mixin() {
      const ctx = WorkContext.current();
      return ctx ? { correlationId: ctx.correlationId, origin: ctx.origin } : {};
    },
    transport:
      config.NODE_ENV === 'development'
        ? { target: 'pino-pretty', options: { singleLine: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname' } }
        : undefined,
  });
  return root;
}

export const createLogger = (scope: string): Logger => rootLogger().child({ scope });
export type { Logger };
