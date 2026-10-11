import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { WorkContext, createLogger } from '@ot/core';

const log = createLogger('http');
const HEADER = 'x-correlation-id';

/** Opens a WorkContext per request (correlationId from the header, or a new one) and logs the request. */
export function correlationMiddleware(req: Request, res: Response, next: NextFunction) {
  const incoming = req.header(HEADER);
  const correlationId = incoming && /^[\w.-]{1,100}$/.test(incoming) ? incoming : randomUUID();
  res.setHeader(HEADER, correlationId);
  WorkContext.run({ correlationId, origin: `http:${req.method} ${req.path}` }, () => {
    const started = Date.now();
    res.on('finish', () => {
      const level = res.statusCode >= 500 ? 'error' : req.path === '/health' ? 'debug' : 'info';
      log[level]({ status: res.statusCode, ms: Date.now() - started }, `${req.method} ${req.originalUrl}`);
    });
    next();
  });
}
