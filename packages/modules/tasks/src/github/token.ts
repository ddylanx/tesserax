import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createLogger } from '@tesserax/core';
import type { AppConfig } from '@tesserax/config';

const execFileAsync = promisify(execFile);
const log = createLogger('tasks.github.token');

// Cache only successful `gh` token lookups for the process; avoids spawning `gh` on every sync tick.
let _cachedGhToken: string | undefined = undefined;

/**
 * Resolves a GitHub personal access token.
 * Priority: GITHUB_TOKEN env/config > `gh auth token` CLI > null.
 * The token is never logged.
 */
export async function resolveGithubToken(
  config: Pick<AppConfig, 'GITHUB_TOKEN'>,
  execFn: (file: string, args: string[], options: { timeout: number }) => Promise<{ stdout: string }> = execFileAsync as never,
): Promise<string | null> {
  // Explicit config always takes precedence and is not cached
  if (config.GITHUB_TOKEN) {
    return config.GITHUB_TOKEN;
  }

  if (_cachedGhToken) {
    return _cachedGhToken;
  }

  try {
    const { stdout } = await execFn('gh', ['auth', 'token'], { timeout: 5000 });
    const token = stdout.trim();
    if (token) {
      log.debug('resolved GitHub token via gh auth token');
      _cachedGhToken = token;
      return token;
    }
  } catch (e) {
    const err = e as { code?: string; message?: string };
    // ENOENT = gh not installed; anything else is worth a debug log
    if (err.code !== 'ENOENT') {
      log.debug({ code: err.code }, 'gh auth token returned non-zero or empty');
    }
  }

  // Do not cache null so a subsequent gh login is picked up without process restart
  return null;
}

/** Reset the in-process cache (for tests only). */
export function _resetTokenCache(): void {
  _cachedGhToken = undefined;
}
