import type { NextFunction, Request, Response } from 'express';
import { createLogger } from '@tesserax/core';

const log = createLogger('http');

/**
 * Hosts the api answers to: loopback on the api port and on the web port (the Vite dev proxy keeps the browser's Host,
 * it does not set changeOrigin), API_HOST, and the host of WEB_BASE_URL (e.g. tesserax.local:5180).
 * Anything else is refused, so a web page on another name that resolves to 127.0.0.1 (DNS rebinding) cannot reach the api.
 */
export function allowedHosts(c: { API_HOST: string; API_PORT: number; WEB_PORT: number; WEB_BASE_URL?: string }): Set<string> {
  const hosts = new Set<string>();
  for (const port of [c.API_PORT, c.WEB_PORT]) for (const name of ['127.0.0.1', 'localhost', '[::1]', c.API_HOST]) hosts.add(`${name}:${port}`.toLowerCase());
  if (c.WEB_BASE_URL) {
    try {
      const u = new URL(c.WEB_BASE_URL);
      hosts.add(u.host.toLowerCase());
      // URL drops the default port; browsers then send the bare name
      if (!u.port) hosts.add(u.hostname.toLowerCase());
    } catch {
      log.warn('WEB_BASE_URL is not a URL; only loopback hosts are allowed');
    }
  }
  return hosts;
}

export function hostGuard(allowed: Set<string>) {
  return (req: Request, res: Response, next: NextFunction) => {
    const host = (req.headers.host ?? '').toLowerCase();
    if (allowed.has(host)) return next();
    log.warn({ host: host.slice(0, 200) }, 'request refused: unknown Host header');
    res.status(403).json({ statusCode: 403, message: 'Unknown Host header' });
  };
}
