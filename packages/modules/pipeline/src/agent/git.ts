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
 * The worktree for `branch` of `repoPath`, created under <dataDir>/worktrees when missing.
 * Reuses an existing worktree or branch (re-runs); never touches the main checkout's files or branch.
 */
export async function ensureWorktree(repoPath: string, branch: string, dataDir: string): Promise<{ path: string; created: boolean }> {
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
  await git(repoPath, exists ? ['worktree', 'add', path, branch] : ['worktree', 'add', '-b', branch, path, 'HEAD']);
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

/** Changes in the worktree relative to where the branch left the main checkout's HEAD (committed + uncommitted). */
export async function diffInfo(worktree: string, repoPath: string): Promise<DiffInfo> {
  const mainHead = (await git(repoPath, ['rev-parse', 'HEAD'])).trim();
  const base = (await git(worktree, ['merge-base', 'HEAD', mainHead]).catch(() => mainHead)).trim();
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
