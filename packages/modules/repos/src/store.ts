import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { findRepoRoot } from '@tesserax/config';
import {
  repoRegistrySchema, repositorySchema, workplaceSchema,
  type RepoInspection, type RepoRegistry, type Repository, type ResolvedWorkplace, type Workplace, type WorkplaceStatus,
} from '@tesserax/contracts';

const git = (cwd: string, args: string[]) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', timeout: 10_000, stdio: ['ignore', 'pipe', 'ignore'], env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } }).trim();
const tryGit = (cwd: string, args: string[]) => {
  try {
    return git(cwd, args) || null;
  } catch {
    return null;
  }
};

/** Absolute, inside the home folder, an existing git checkout (a repository root or a worktree). */
export function checkCheckoutPath(p: string, home = homedir()): string {
  const abs = resolve(p.trim().replace(/^~(?=\/|$)/, home));
  if (!isAbsolute(abs) || !(abs === home || abs.startsWith(`${home}/`))) throw new Error('The path must be an absolute path inside your home folder.');
  if (!existsSync(abs) || !statSync(abs).isDirectory()) throw new Error(`Folder not found: ${abs}`);
  if (!existsSync(join(abs, '.git'))) throw new Error(`Not a git checkout (no .git): ${abs}`);
  return abs;
}

/** ssh and https spellings of the same remote compare equal: host + path, no user, no .git, lower case. */
export function normalizeOrigin(url: string | null | undefined): string | null {
  if (!url) return null;
  const u = url.trim();
  const m = /^(?:[\w+.-]+:\/\/)?(?:[^@/]+@)?([^/:]+)[:/](.+?)(?:\.git)?\/?$/.exec(u);
  return m ? `${m[1]!.toLowerCase()}/${m[2]!.toLowerCase()}` : u.toLowerCase();
}

const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'repo';

/** Legacy config/repos.json entry: project key -> path, or { path, base, remote, bitbucket }. */
type LegacyEntry = string | { path: string; base?: string; remote?: string; bitbucket?: string };

/** Detects project stack conventions (test_command, worktree_links) from checkout manifest files. */
export function detectRepoStack(checkoutPath: string): Record<string, string> {
  const pkgJsonPath = join(checkoutPath, 'package.json');
  if (existsSync(pkgJsonPath)) {
    let scripts: Record<string, unknown> = {};
    try {
      const parsed = JSON.parse(readFileSync(pkgJsonPath, 'utf8'));
      if (parsed && typeof parsed.scripts === 'object' && parsed.scripts) {
        scripts = parsed.scripts as Record<string, unknown>;
      }
    } catch {
      // ignore parse error, fallback to default scripts
    }

    // Hybrid projects (e.g. Laravel with Vite, Python/Go with frontend):
    // if package.json has no test script, but a backend manifest exists, prioritize the backend stack.
    const hasNodeTest = 'test' in scripts;
    if (!hasNodeTest) {
      if (existsSync(join(checkoutPath, 'composer.json'))) {
        return {
          test_command: 'composer test',
          worktree_links: 'vendor, .env',
        };
      }
      if (existsSync(join(checkoutPath, 'pyproject.toml'))) {
        return {
          test_command: 'pytest',
          worktree_links: '.venv, .env',
        };
      }
      if (existsSync(join(checkoutPath, 'go.mod'))) {
        return {
          test_command: 'go test ./...',
          worktree_links: '.env',
        };
      }
    }

    const hasPnpm = existsSync(join(checkoutPath, 'pnpm-lock.yaml'));
    const hasYarn = existsSync(join(checkoutPath, 'yarn.lock'));
    const hasBun = existsSync(join(checkoutPath, 'bun.lockb')) || existsSync(join(checkoutPath, 'bun.lock'));

    const cmds: string[] = [];

    if (hasPnpm) {
      cmds.push('pnpm install --frozen-lockfile --prefer-offline');
      if ('typecheck' in scripts) cmds.push('pnpm typecheck');
      if ('lint' in scripts) cmds.push('pnpm lint');
      if ('test' in scripts) cmds.push('pnpm test');
      if (cmds.length === 1) cmds.push('pnpm test');
      return {
        test_command: cmds.join(' && '),
        worktree_links: '.env',
      };
    }

    const pm = hasYarn ? 'yarn' : hasBun ? 'bun' : 'npm';
    if (pm === 'yarn') {
      if ('typecheck' in scripts) cmds.push('yarn typecheck');
      if ('lint' in scripts) cmds.push('yarn lint');
      if ('test' in scripts) cmds.push('yarn test');
      if (cmds.length === 0) cmds.push('yarn test');
    } else if (pm === 'bun') {
      if ('typecheck' in scripts) cmds.push('bun run typecheck');
      if ('lint' in scripts) cmds.push('bun run lint');
      if ('test' in scripts) cmds.push('bun test');
      if (cmds.length === 0) cmds.push('bun test');
    } else {
      // npm
      if ('typecheck' in scripts) cmds.push('npm run typecheck');
      if ('lint' in scripts) cmds.push('npm run lint');
      if ('test' in scripts) cmds.push('npm test');
      if (cmds.length === 0) cmds.push('npm test');
    }

    return {
      test_command: cmds.join(' && '),
      worktree_links: 'node_modules, .env',
    };
  }

  if (existsSync(join(checkoutPath, 'composer.json'))) {
    return {
      test_command: 'composer test',
      worktree_links: 'vendor, .env',
    };
  }

  if (existsSync(join(checkoutPath, 'pyproject.toml'))) {
    return {
      test_command: 'pytest',
      worktree_links: '.venv, .env',
    };
  }

  if (existsSync(join(checkoutPath, 'go.mod'))) {
    return {
      test_command: 'go test ./...',
      worktree_links: '.env',
    };
  }

  return {};
}

export class RepoRegistryStore {
  constructor(
    readonly file = process.env.OT_WORKPLACES_FILE || join(findRepoRoot(), 'config', 'workplaces.json'),
    readonly legacyFile = process.env.OT_REPOS_FILE || join(findRepoRoot(), 'config', 'repos.json'),
  ) {}

  /** The registry; the first time, it is created from config/repos.json (one workplace per project key). */
  read(): RepoRegistry {
    if (existsSync(this.file)) {
      const parsed = repoRegistrySchema.safeParse(JSON.parse(readFileSync(this.file, 'utf8')));
      if (parsed.success) return parsed.data;
      throw new Error(`${this.file} is not valid: ${parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
    }
    const imported = this.importLegacy();
    if (imported.workplaces.length) this.write(imported);
    return imported;
  }

  private importLegacy(): RepoRegistry {
    const reg: RepoRegistry = { repositories: [], workplaces: [] };
    if (!existsSync(this.legacyFile)) return reg;
    let legacy: Record<string, LegacyEntry>;
    try {
      legacy = JSON.parse(readFileSync(this.legacyFile, 'utf8')) as Record<string, LegacyEntry>;
    } catch {
      return reg;
    }
    for (const [project, raw] of Object.entries(legacy)) {
      const e = typeof raw === 'string' ? { path: raw } : raw;
      if (!e?.path) continue;
      const origin = tryGit(e.path, ['remote', 'get-url', e.remote ?? 'origin']);
      let repo = reg.repositories.find(r => (origin && normalizeOrigin(r.origin) === normalizeOrigin(origin)) || r.id === slugify(basename(e.path)));
      if (!repo) {
        repo = { id: slugify(basename(e.path)), name: basename(e.path), origin, ...(e.base ? { base: e.base } : {}), ...(e.remote ? { remote: e.remote } : {}), ...(e.bitbucket ? { bitbucket: e.bitbucket } : {}) };
        reg.repositories.push(repo);
      }
      reg.workplaces.push({ id: slugify(`${repo.id}-${project}`), repositoryId: repo.id, brand: project, path: e.path, projects: [project], ...(e.base && e.base !== repo.base ? { base: e.base } : {}) });
    }
    return reg;
  }

  private write(reg: RepoRegistry) {
    mkdirSync(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(reg, null, 2)}\n`);
    renameSync(tmp, this.file);
  }

  saveRepository(input: unknown): RepoRegistry {
    const repo = repositorySchema.parse(input);
    const reg = this.read();
    const i = reg.repositories.findIndex(r => r.id === repo.id);
    if (i >= 0) reg.repositories[i] = repo;
    else reg.repositories.push(repo);
    this.write(reg);
    return reg;
  }

  deleteRepository(id: string): RepoRegistry {
    const reg = this.read();
    const used = reg.workplaces.filter(w => w.repositoryId === id);
    if (used.length) throw new Error(`Remove its workplaces first: ${used.map(w => w.brand).join(', ')}.`);
    reg.repositories = reg.repositories.filter(r => r.id !== id);
    this.write(reg);
    return reg;
  }

  saveWorkplace(input: unknown): RepoRegistry {
    const parsed = workplaceSchema.parse(input);
    const w: Workplace = { ...parsed, path: checkCheckoutPath(parsed.path) };
    const reg = this.read();
    if (!reg.repositories.some(r => r.id === w.repositoryId)) throw new Error(`Unknown repository: ${w.repositoryId}`);
    const i = reg.workplaces.findIndex(x => x.id === w.id);
    if (i >= 0) reg.workplaces[i] = w;
    else reg.workplaces.push(w);
    this.write(reg);
    return reg;
  }

  deleteWorkplace(id: string): RepoRegistry {
    const reg = this.read();
    reg.workplaces = reg.workplaces.filter(w => w.id !== id);
    this.write(reg);
    return reg;
  }

  status(w: Workplace, repo?: Repository): WorkplaceStatus {
    if (!existsSync(w.path)) return { exists: false, isGit: false, origin: null, branch: null, originMatches: null, error: 'Folder not found' };
    if (!existsSync(join(w.path, '.git'))) return { exists: true, isGit: false, origin: null, branch: null, originMatches: null, error: 'Not a git checkout' };
    const origin = tryGit(w.path, ['remote', 'get-url', repo?.remote ?? 'origin']);
    const branch = tryGit(w.path, ['symbolic-ref', '--quiet', '--short', 'HEAD']);
    const want = normalizeOrigin(repo?.origin);
    const have = normalizeOrigin(origin);
    return { exists: true, isGit: true, origin, branch, originMatches: want && have ? want === have : null, error: null };
  }

  detectRepoStack(checkoutPath: string): Record<string, string> {
    return detectRepoStack(checkoutPath);
  }

  /** What a folder is, to prefill "register" forms. */
  inspect(path: string): RepoInspection {
    const abs = checkCheckoutPath(path);
    const origin = tryGit(abs, ['remote', 'get-url', 'origin']);
    const head = tryGit(abs, ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD']);
    const top = tryGit(abs, ['rev-parse', '--show-toplevel']) ?? abs;
    const reg = this.read();
    const match = reg.repositories.find(r => origin && normalizeOrigin(r.origin) === normalizeOrigin(origin));
    return {
      path: abs, isGit: true, origin, branch: tryGit(abs, ['symbolic-ref', '--quiet', '--short', 'HEAD']),
      defaultBranch: head ? head.replace(/^origin\//, '') : null,
      suggestedName: origin ? basename(origin.replace(/\.git$/, '')) : basename(top), repositoryId: match?.id ?? null,
      suggestedVars: this.detectRepoStack(abs),
    };
  }

  /**
   * The workplace a task works in: the one picked on the task, else the first registered for its project,
   * else the legacy config/repos.json entry. Null when nothing matches.
   */
  resolve(task: { project?: string | null; workplaceId?: string | null }): ResolvedWorkplace | null {
    const reg = this.read();
    const w = (task.workplaceId && reg.workplaces.find(x => x.id === task.workplaceId))
      || (task.project ? reg.workplaces.find(x => x.projects.includes(task.project!)) : undefined);
    if (w) {
      const repo = reg.repositories.find(r => r.id === w.repositoryId);
      return {
        workplaceId: w.id, brand: w.brand, repositoryId: repo?.id ?? null, repositoryName: repo?.name ?? null, origin: repo?.origin ?? null,
        path: w.path, base: w.base ?? repo?.base, remote: repo?.remote, bitbucket: repo?.bitbucket,
      };
    }
    if (!task.project || !existsSync(this.legacyFile)) return null;
    try {
      const raw = (JSON.parse(readFileSync(this.legacyFile, 'utf8')) as Record<string, LegacyEntry>)[task.project];
      if (!raw) return null;
      const e = typeof raw === 'string' ? { path: raw } : raw;
      return { workplaceId: null, brand: null, repositoryId: null, repositoryName: null, origin: null, ...e };
    } catch {
      return null;
    }
  }
}

/** Shared instance for code that is not injected (jobs, helpers). Reads the file on every call, so edits apply at once. */
export const repoRegistry = new RepoRegistryStore();
