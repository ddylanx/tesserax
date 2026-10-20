import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export interface SyncAntigravityOptions {
  settingsFile?: string;
  managedServers?: string[];
  previousRules?: string[];
}

export function defaultAntigravitySettingsPath(): string {
  return join(homedir(), '.gemini', 'antigravity-cli', 'settings.json');
}

/**
 * Synchronizes Tesserax MCP permissions into ~/.gemini/antigravity-cli/settings.json.
 * Only manages rules for Tesserax servers, preserving user's own rules and unknown settings keys.
 * Writes atomically via a temporary file with mode 0600 followed by rename.
 */
export async function syncAntigravityMcpRules(
  allowedRules: string[],
  options?: SyncAntigravityOptions | string,
): Promise<void> {
  const opts: SyncAntigravityOptions = typeof options === 'string' ? { settingsFile: options } : (options ?? {});
  const filePath = opts.settingsFile ?? defaultAntigravitySettingsPath();

  let settings: Record<string, any> = {};
  if (existsSync(filePath)) {
    try {
      settings = JSON.parse(readFileSync(filePath, 'utf8'));
    } catch {
      settings = {};
    }
  }

  settings.permissions ??= {};
  const currentAllow: unknown[] = Array.isArray(settings.permissions.allow) ? settings.permissions.allow : [];

  const managedServers = new Set(opts.managedServers ?? []);
  const previousRules = new Set(opts.previousRules ?? []);

  const serversInAllowed = new Set<string>();
  for (const r of allowedRules) {
    const m = /^mcp\(\s*([^/\s]+)\s*\/\s*(.+?)\s*\)$/.exec(r);
    if (m && m[1]) serversInAllowed.add(m[1]);
  }

  const isTesseraxManaged = (rule: unknown): boolean => {
    if (typeof rule !== 'string') return false;
    const trimmed = rule.trim();
    if (previousRules.has(trimmed)) return true;

    const m = /^mcp\(\s*([^/\s]+)\s*\/\s*(.+?)\s*\)$/.exec(trimmed);
    if (!m || !m[1]) return false;
    const srv = m[1];

    if (managedServers.size > 0) {
      return managedServers.has(srv);
    }
    return serversInAllowed.has(srv);
  };

  const remainingUserRules = currentAllow.filter(r => !isTesseraxManaged(r));

  const newAllow = [...remainingUserRules];
  for (const r of allowedRules) {
    if (!newAllow.includes(r)) {
      newAllow.push(r);
    }
  }

  settings.permissions.allow = newAllow;

  const dir = dirname(filePath);
  mkdirSync(dir, { recursive: true });

  const tmpFile = `${filePath}.tmp.${process.pid}.${Date.now()}`;
  try {
    writeFileSync(tmpFile, JSON.stringify(settings, null, 2), { mode: 0o600 });
    renameSync(tmpFile, filePath);
  } catch (err) {
    try {
      if (existsSync(tmpFile)) unlinkSync(tmpFile);
    } catch {
      /* ignore */
    }
    throw err;
  }
}
