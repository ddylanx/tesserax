import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

export interface Endpoints {
  /** Base URL of the API, without the /api prefix, e.g. http://127.0.0.1:4400 */
  api: string;
  /** Base URL of the web app, for links the person can open. */
  web: string;
}

/** Only these keys are read from `.env`: the server never loads secrets into its own process. */
const KEYS = ['TESSERAX_API_URL', 'API_HOST', 'API_PORT', 'WEB_BASE_URL'] as const;
type Key = (typeof KEYS)[number];

export function readDotEnv(text: string): Partial<Record<Key, string>> {
  const out: Partial<Record<Key, string>> = {};
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!m || !(KEYS as readonly string[]).includes(m[1]!)) continue;
    out[m[1] as Key] = m[2]!.replace(/^(['"])(.*)\1$/, '$2');
  }
  return out;
}

/** Process env wins over `<repo>/.env`; defaults match `pnpm dev`. */
export function resolveEndpoints(env: NodeJS.ProcessEnv = process.env, repoRoot = resolve(__dirname, '../../..')): Endpoints {
  const file = join(repoRoot, '.env');
  const dot = existsSync(file) ? readDotEnv(readFileSync(file, 'utf8')) : {};
  const get = (k: Key) => env[k] || dot[k];
  let host = get('API_HOST') || '127.0.0.1';
  if (host === '0.0.0.0' || host === '::') host = '127.0.0.1';
  const api = get('TESSERAX_API_URL') || `http://${host}:${get('API_PORT') || '4400'}`;
  const web = get('WEB_BASE_URL') || 'http://127.0.0.1:5180';
  return { api: api.replace(/\/+$/, ''), web: web.replace(/\/+$/, '') };
}
