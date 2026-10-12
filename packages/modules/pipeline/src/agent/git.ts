import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import { promisify } from 'node:util';

const exec = promisify(execFile);

export async function git(cwd: string, args: string[], maxBuffer = 10 * 1024 * 1024): Promise<string> {
  const { stdout } = await exec('git', args, { cwd, maxBuffer, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
  return stdout;
}

/** A branch name git accepts: letters, digits, . _ / - (same rule as agent-cockpit's checkBranch). */
export function checkBranch(name: string): string {
  const b = String(name || '').trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._/-]{0,99}$/.test(b) || /\.\.|\/\/|\.lock$|[./]$|@\{/.test(b)) throw new Error(`Invalid branch name: ${name}`);
  return b;
}

/**
 * Where new issue branches start: the configured base (e.g. "develop" -> origin/develop when it exists),
 * else the remote's default branch (origin/HEAD), else the main checkout's HEAD.
 * Never the main checkout's current branch when a default is known: that is often someone's feature branch.
 */
export async function resolveBaseRef(repoPath: string, configured?: string | null): Promise<string> {
  const exists = (ref: string) => git(repoPath, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]).then(() => true, () => false);
  if (configured) {
    if (!configured.startsWith('origin/') && (await exists(`origin/${configured}`))) return `origin/${configured}`;
    if (await exists(configured)) return configured;
    throw new Error(`Base branch "${configured}" not found in ${repoPath}`);
  }
  const head = (await git(repoPath, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD']).catch(() => '')).trim();
  if (head && (await exists(head))) return head;
  for (const b of ['origin/develop', 'origin/main', 'origin/master']) if (await exists(b)) return b;
  return 'HEAD';
}

/** Best effort: refresh the base branch from the remote (read-only, 30 s, never prompts). */
export async function fetchBase(repoPath: string, baseRef: string): Promise<boolean> {
  const m = baseRef.match(/^origin\/(.+)$/);
  if (!m) return false;
  try {
    await execFileTimeout('git', ['fetch', '--quiet', 'origin', m[1]!], repoPath, 30_000);
    return true;
  } catch {
    return false;
  }
}

function execFileTimeout(cmd: string, args: string[], cwd: string, timeout: number) {
  return exec(cmd, args, {
    cwd, timeout,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_SSH_COMMAND: 'ssh -o BatchMode=yes -o ConnectTimeout=10' },
  });
}

/**
 * The worktree for `branch` of `repoPath`, created under <dataDir>/worktrees when missing (new branches start at
 * `baseRef`). Reuses an existing worktree or branch (re-runs); never touches the main checkout's files or branch.
 */
export async function ensureWorktree(repoPath: string, branch: string, dataDir: string, baseRef = 'HEAD'): Promise<{ path: string; created: boolean }> {
  checkBranch(branch);
  const list = await git(repoPath, ['worktree', 'list', '--porcelain']);
  for (const block of list.split('\n\n')) {
    const path = block.match(/^worktree (.+)$/m)?.[1];
    const br = block.match(/^branch refs\/heads\/(.+)$/m)?.[1];
    if (path && br === branch && existsSync(path)) return { path, created: false };
  }
  await git(repoPath, ['worktree', 'prune']);
  const repoId = `${basename(repoPath)}-${createHash('sha1').update(repoPath).digest('hex').slice(0, 6)}`;
  const path = join(dataDir, 'worktrees', repoId, branch.replace(/\//g, '__'));
  mkdirSync(join(dataDir, 'worktrees', repoId), { recursive: true });
  const exists = await git(repoPath, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`]).then(() => true, () => false);
  await git(repoPath, exists ? ['worktree', 'add', path, branch] : ['worktree', 'add', '--no-track', '-b', branch, path, baseRef]);
  return { path, created: true };
}

export interface DiffInfo {
  base: string;
  files: number;
  insertions: number;
  deletions: number;
  stat: string;
  untracked: string[];
  commits: string[];
}

/** Changes in the worktree since it left `baseRef` (committed + uncommitted + new files). */
export async function diffInfo(worktree: string, baseRef: string): Promise<DiffInfo> {
  const baseSha = (await git(worktree, ['rev-parse', `${baseRef}^{commit}`])).trim();
  const base = (await git(worktree, ['merge-base', 'HEAD', baseSha]).catch(() => baseSha)).trim();
  const short = await git(worktree, ['diff', '--shortstat', base]);
  const n = (re: RegExp) => Number(short.match(re)?.[1] ?? 0);
  const stat = (await git(worktree, ['diff', '--stat=120', base])).trim();
  const untracked = (await git(worktree, ['ls-files', '--others', '--exclude-standard'])).split('\n').filter(Boolean);
  const commits = (await git(worktree, ['log', '--oneline', '--no-decorate', `${base}..HEAD`])).split('\n').filter(Boolean);
  return {
    base,
    files: n(/(\d+) files? changed/) + untracked.length,
    insertions: n(/(\d+) insertions?/),
    deletions: n(/(\d+) deletions?/),
    stat,
    untracked,
    commits,
  };
}

/** Full patch for review: tracked changes vs base plus new files (capped). */
export async function diffPatch(worktree: string, base: string, maxBytes = 400_000): Promise<{ patch: string; truncated: boolean }> {
  let patch = await git(worktree, ['diff', '--no-color', base], 50 * 1024 * 1024);
  const untracked = (await git(worktree, ['ls-files', '--others', '--exclude-standard'])).split('\n').filter(Boolean);
  for (const f of untracked.slice(0, 50)) {
    patch += await git(worktree, ['diff', '--no-color', '--no-index', '/dev/null', f]).catch(e => String((e as { stdout?: string }).stdout ?? ''));
  }
  return patch.length > maxBytes ? { patch: patch.slice(0, maxBytes), truncated: true } : { patch, truncated: false };
}
