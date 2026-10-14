import type { LoggerService } from '@nestjs/common';
import { createLogger } from '@tesserax/core';

const log = createLogger('nest');

/** Routes Nest's own logs through pino. */
export class PinoNestLogger implements LoggerService {
  log(message: unknown, context?: string) { log.debug({ context }, String(message)); }
  error(message: unknown, trace?: string, context?: string) { log.error({ context, trace }, String(message)); }
  warn(message: unknown, context?: string) { log.warn({ context }, String(message)); }
  debug(message: unknown, context?: string) { log.debug({ context }, String(message)); }
  verbose(message: unknown, context?: string) { log.trace({ context }, String(message)); }
}
