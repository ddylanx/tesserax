#!/usr/bin/env node
// Starts the local Postgres in Docker, unless .env points DATABASE_URL at another host (e.g. Supabase).
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const root = resolve(dirname(new URL(import.meta.url).pathname), '..');
if (existsSync(join(root, '.env'))) process.loadEnvFile(join(root, '.env'));
const url = process.env.DATABASE_URL;
const host = url ? new URL(url).hostname : '127.0.0.1';
if (['127.0.0.1', 'localhost', '::1'].includes(host)) {
  execSync('docker compose -f infra/compose.dev.yml up -d --wait', { cwd: root, stdio: 'inherit' });
} else {
  console.log(`DATABASE_URL points at ${host}: not starting the local Postgres.`);
}
