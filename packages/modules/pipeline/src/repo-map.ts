import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { findRepoRoot } from '@tesserax/config';
import { repoRegistry } from '@tesserax/mod-repos';
import { repoMapSchema, type RepoMap } from '@tesserax/contracts';

/** config/repos.json (gitignored): Jira project key -> local git repo path. */
export class RepoMapStore {
  constructor(readonly file = process.env.OT_REPOS_FILE || join(findRepoRoot(), 'config', 'repos.json')) {}

  read(): RepoMap {
    if (!existsSync(this.file)) return {};
    const parsed = repoMapSchema.safeParse(JSON.parse(readFileSync(this.file, 'utf8')));
    return parsed.success ? parsed.data : {};
  }

  /** The repo for a project: its workplace on the Repos page (config/workplaces.json), else this file. */
  entry(project: string | null): { path: string; base?: string; remote?: string; bitbucket?: string } | null {
    const w = project ? repoRegistry.resolve({ project }) : null;
    if (w) return { path: w.path, base: w.base, remote: w.remote, bitbucket: w.bitbucket };
    const e = project ? this.read()[project] : undefined;
    if (!e) return null;
    return typeof e === 'string' ? { path: e } : e;
  }

  forProject(project: string | null): string | null {
    return this.entry(project)?.path ?? null;
  }

  /** Keeps a configured base branch when only the path changes. */
  set(project: string, path: string): RepoMap {
    const { path: _old, ...rest } = this.entry(project) ?? { path: '' };
    const checked = checkRepoPath(path);
    const map = { ...this.read(), [project]: Object.keys(rest).length ? { path: checked, ...rest } : checked };
    mkdirSync(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(map, null, 2)}\n`);
    renameSync(tmp, this.file);
    return map;
  }
}

/** Absolute, inside the home folder, an existing git repository root. */
export function checkRepoPath(p: string, home = homedir()): string {
  const abs = resolve(p.replace(/^~(?=\/|$)/, home));
  if (!isAbsolute(abs) || !(abs === home || abs.startsWith(`${home}/`))) throw new Error('The repo must be an absolute path inside your home folder.');
  if (!existsSync(abs) || !statSync(abs).isDirectory()) throw new Error(`Folder not found: ${abs}`);
  if (!existsSync(join(abs, '.git'))) throw new Error(`Not a git repository root (no .git): ${abs}`);
  return abs;
}
