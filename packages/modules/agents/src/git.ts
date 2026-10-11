import { readFileSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';

/** Current branch of the repo containing `cwd` (reads .git/HEAD; supports worktrees). Null when detached or not a repo. */
export function readBranch(cwd: string | null | undefined): string | null {
  if (!cwd) return null;
  let dir = resolve(cwd);
  for (let i = 0; i < 40; i++) {
    const dotGit = join(dir, '.git');
    try {
      const st = statSync(dotGit);
      let gitDir = dotGit;
      if (st.isFile()) {
        const m = readFileSync(dotGit, 'utf8').match(/^gitdir:\s*(.+)$/m);
        if (!m?.[1]) return null;
        gitDir = isAbsolute(m[1].trim()) ? m[1].trim() : resolve(dir, m[1].trim());
      }
      const head = readFileSync(join(gitDir, 'HEAD'), 'utf8').trim();
      const ref = head.match(/^ref:\s*refs\/heads\/(.+)$/);
      return ref?.[1] ?? (head ? `detached@${head.slice(0, 7)}` : null);
    } catch {
      const parent = dirname(dir);
      if (parent === dir) return null;
      dir = parent;
    }
  }
  return null;
}
