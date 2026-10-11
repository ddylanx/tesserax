import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { findRepoRoot } from '@ot/config';
import { repoMapSchema, type RepoMap } from '@ot/contracts';

/** config/repos.json (gitignored): Jira project key -> local git repo path. */
export class RepoMapStore {
  constructor(readonly file = join(findRepoRoot(), 'config', 'repos.json')) {}

  read(): RepoMap {
    if (!existsSync(this.file)) return {};
    const parsed = repoMapSchema.safeParse(JSON.parse(readFileSync(this.file, 'utf8')));
    return parsed.success ? parsed.data : {};
  }

  forProject(project: string | null): string | null {
    return project ? this.read()[project] ?? null : null;
  }

  set(project: string, path: string): RepoMap {
    const map = { ...this.read(), [project]: checkRepoPath(path) };
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
