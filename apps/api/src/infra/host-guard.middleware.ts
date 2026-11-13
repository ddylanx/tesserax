import type { NextFunction, Request, Response } from 'express';
import { createLogger } from '@tesserax/core';

const log = createLogger('http');

/** Loopback names are always allowed, on any port (local tools such as an MCP server call the api with Node fetch). */
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]']);

/** `name:port` -> name (lowercase); null when the header is not a host[:port]. IPv6 keeps its brackets. */
export function hostnameOf(host: string): string | null {
  const m = /^(\[[0-9a-f:.]+\]|[a-z0-9.-]+)(?::(\d{1,5}))?$/i.exec(host.trim());
  return m ? m[1]!.toLowerCase() : null;
}

/**
 * Hosts the api answers to besides loopback: API_HOST on the api port, and the host of WEB_BASE_URL (e.g. tesserax.local:5180;
 * the Vite dev proxy keeps the browser's Host, it does not set changeOrigin).
 * Anything else is refused, so a web page on another name that resolves to 127.0.0.1 (DNS rebinding) cannot reach the api.
 */
export function allowedHosts(c: { API_HOST: string; API_PORT: number; WEB_PORT: number; WEB_BASE_URL?: string }): Set<string> {
  const hosts = new Set<string>([`${c.API_HOST}:${c.API_PORT}`.toLowerCase()]);
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

export function isAllowedHost(host: string | undefined, allowed: Set<string>): boolean {
  const name = hostnameOf(host ?? '');
  if (!name) return false;
  return LOOPBACK.has(name) || allowed.has(host!.trim().toLowerCase());
}

/** Applies to every path, /health and /api/openapi.json included. */
export function hostGuard(allowed: Set<string>) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (isAllowedHost(req.headers.host, allowed)) return next();
    log.warn({ host: String(req.headers.host ?? '').slice(0, 200) }, 'request refused: unknown Host header');
    res.status(403).json({ statusCode: 403, message: 'Unknown Host header' });
  };
}
