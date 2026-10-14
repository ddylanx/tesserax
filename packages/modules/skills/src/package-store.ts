import { execFile } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { promisify } from 'node:util';
import { skillPackageManifestSchema, type InstallSkillPackage, type PackageSkill, type SkillPackage, type SkillPackageManifest } from './contracts';
import { frontmatterField, sha } from './frontmatter';

const exec = promisify(execFile);

/** Clones `source` at `ref` into `dir` and returns the commit. Swappable in tests. */
export type Fetcher = (source: string, ref: string | null, dir: string) => Promise<string>;

/** Only plain https / ssh remotes: no file://, ext:: or other transports that can run commands. */
export function checkSource(source: string): void {
  if (!/^(https:\/\/[\w.-]+(:\d+)?\/[\w./~-]+|git@[\w.-]+:[\w./~-]+)$/.test(source)) {
    throw new Error('Use an https:// or git@host:owner/repo git URL');
  }
}

export const gitFetcher: Fetcher = async (source, ref, dir) => {
  checkSource(source);
  if (ref && !/^[\w./-]+$/.test(ref)) throw new Error('Invalid branch or tag');
  const env = { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_SSH_COMMAND: 'ssh -o BatchMode=yes -o ConnectTimeout=15' };
  // No submodules, no hooks or LFS filters: only files are read from the clone.
  const args = ['-c', 'core.hooksPath=/dev/null', 'clone', '--quiet', '--depth', '1', '--no-recurse-submodules', ...(ref ? ['--branch', ref] : []), '--', source, dir];
  try {
    await exec('git', args, { env, timeout: 120_000 });
  } catch (e) {
    throw new Error(`git clone failed: ${String((e as { stderr?: string }).stderr ?? (e as Error).message).trim().slice(0, 400)}`);
  }
  return (await exec('git', ['rev-parse', 'HEAD'], { cwd: dir, env })).stdout.trim();
};

/**
 * Where a repo keeps its skills: skills/<name>/SKILL.md, else <name>/SKILL.md at the top level, else a single root
 * SKILL.md. Dot folders (copies made for other agents, e.g. .openclaw/) are ignored.
 */
export function discoverSkills(repo: string): { name: string; dir: string }[] {
  const children = (dir: string) =>
    existsSync(dir)
      ? readdirSync(dir, { withFileTypes: true })
          .filter(d => d.isDirectory() && !d.name.startsWith('.') && existsSync(join(dir, d.name, 'SKILL.md')))
          .map(d => ({ name: d.name.toLowerCase(), dir: join(dir, d.name) }))
      : [];
  const nested = children(join(repo, 'skills'));
  if (nested.length) return nested;
  const top = children(repo);
  if (top.length) return top;
  if (existsSync(join(repo, 'SKILL.md'))) {
    const name = frontmatterField(readFileSync(join(repo, 'SKILL.md'), 'utf8'), 'name').toLowerCase();
    return [{ name: /^[a-z0-9][a-z0-9-]*$/.test(name) ? name : 'skill', dir: repo }];
  }
  return [];
}

/** Text files a skill may reference (references/*.md etc.). Scripts and binaries are not copied: skills here are prompt text. */
const COPY = /\.(md|txt)$/i;
function copySkill(from: string, to: string, recurse: boolean) {
  mkdirSync(to, { recursive: true });
  for (const d of readdirSync(from, { withFileTypes: true })) {
    if (d.name.startsWith('.')) continue;
    const src = join(from, d.name);
    if (d.isDirectory()) {
      if (recurse) copySkill(src, join(to, d.name), true);
    } else if (d.isFile() && COPY.test(d.name) && statSync(src).size < 512 * 1024) cpSync(src, join(to, d.name));
  }
}

function metadata(repo: string): { version: string | null; license: string | null } {
  let version: string | null = null;
  for (const f of ['package.json', 'plugin.json', '.claude-plugin/plugin.json']) {
    try {
      const v = (JSON.parse(readFileSync(join(repo, f), 'utf8')) as { version?: unknown }).version;
      if (typeof v === 'string') { version = v; break; }
    } catch { /* not there */ }
  }
  const licenseFile = ['LICENSE', 'LICENSE.md', 'LICENSE.txt'].map(f => join(repo, f)).find(existsSync);
  const license = licenseFile ? readFileSync(licenseFile, 'utf8').split('\n').find(l => l.trim())?.trim().slice(0, 80) ?? null : null;
  return { version, license };
}

/**
 * External skill packages. Manifest: skills/packages.json. Files: skills/_packages/<id>/<skill>/SKILL.md (+ LICENSE).
 * Workflow nodes reference the copied files by path, like any other skill, so runs record the exact version used.
 */
export class SkillPackageStore {
  readonly manifestFile: string;
  readonly dir: string;

  constructor(
    readonly root: string,
    private readonly fetch: Fetcher = gitFetcher,
    private readonly usedByHost: (pathPrefix: string) => string[] = () => [],
    readonly skillsDir = 'skills',
  ) {
    this.manifestFile = join(root, skillsDir, 'packages.json');
    this.dir = join(root, skillsDir, '_packages');
  }

  read(): SkillPackageManifest {
    if (!existsSync(this.manifestFile)) return { packages: [] };
    return skillPackageManifestSchema.parse(JSON.parse(readFileSync(this.manifestFile, 'utf8')));
  }

  private write(m: SkillPackageManifest) {
    m.packages.sort((a, b) => a.category.localeCompare(b.category) || a.id.localeCompare(b.id));
    mkdirSync(join(this.root, this.skillsDir), { recursive: true });
    writeFileSync(`${this.manifestFile}.tmp`, `${JSON.stringify(m, null, 2)}\n`);
    renameSync(`${this.manifestFile}.tmp`, this.manifestFile);
  }

  get(id: string): SkillPackage {
    const p = this.read().packages.find(x => x.id === id);
    if (!p) throw new Error(`Package ${id} is not installed`);
    return p;
  }

  /** Host things (workflows) that reference a skill of this package. */
  usedBy(id: string): string[] {
    return this.usedByHost(`${this.skillsDir}/_packages/${id}/`);
  }

  list() {
    return { packages: this.read().packages.map(p => ({ ...p, usedBy: this.usedBy(p.id) })) };
  }

  skills(): PackageSkill[] {
    return this.read().packages.flatMap(p =>
      p.skills
        .filter(s => existsSync(join(this.dir, p.id, s, 'SKILL.md')))
        .map(s => {
          const text = readFileSync(join(this.dir, p.id, s, 'SKILL.md'), 'utf8');
          return {
            path: `${this.skillsDir}/_packages/${p.id}/${s}/SKILL.md`,
            name: frontmatterField(text, 'name') || s,
            description: frontmatterField(text, 'description'),
            hash: sha(text),
            package: p.id,
            category: p.category,
          };
        }),
    );
  }

  skillContent(id: string, skill: string): { path: string; content: string; hash: string } {
    if (!this.get(id).skills.includes(skill)) throw new Error(`Package ${id} has no skill ${skill}`);
    const path = `${this.skillsDir}/_packages/${id}/${skill}/SKILL.md`;
    const content = readFileSync(join(this.root, path), 'utf8');
    return { path, content, hash: sha(content) };
  }

  async install(req: InstallSkillPackage): Promise<SkillPackage> {
    const id = req.id ?? defaultId(req.source);
    if (this.read().packages.some(p => p.id === id)) throw new Error(`Package ${id} is already installed. Use Update, or pick another id.`);
    const pkg = await this.fetchInto(id, req.source, req.ref || null);
    const now = new Date().toISOString();
    const entry: SkillPackage = { id, source: req.source, ref: req.ref || null, category: req.category, installedAt: now, updatedAt: now, ...pkg };
    const m = this.read();
    m.packages.push(entry);
    this.write(m);
    return entry;
  }

  /** Re-fetches the same source and ref; replaces the files. */
  async update(id: string): Promise<SkillPackage & { changed: boolean }> {
    const cur = this.get(id);
    const pkg = await this.fetchInto(id, cur.source, cur.ref);
    const next = { ...cur, ...pkg, updatedAt: new Date().toISOString() };
    const m = this.read();
    m.packages = m.packages.map(p => (p.id === id ? next : p));
    this.write(m);
    return { ...next, changed: pkg.commit !== cur.commit };
  }

  setCategory(id: string, category: string): SkillPackage {
    const m = this.read();
    const p = m.packages.find(x => x.id === id);
    if (!p) throw new Error(`Package ${id} is not installed`);
    p.category = category;
    this.write(m);
    return p;
  }

  /** Refuses while a workflow still references the package, unless force. */
  remove(id: string, force = false): { removed: string; usedBy: string[] } {
    this.get(id);
    const usedBy = this.usedBy(id);
    if (usedBy.length && !force) throw new Error(`Still used by workflow ${usedBy.join(', ')}. Remove it from those nodes first, or remove anyway.`);
    rmSync(join(this.dir, id), { recursive: true, force: true });
    const m = this.read();
    m.packages = m.packages.filter(p => p.id !== id);
    this.write(m);
    return { removed: id, usedBy };
  }

  private async fetchInto(id: string, source: string, ref: string | null) {
    const tmp = mkdtempSync(join(tmpdir(), 'ot-skillpkg-'));
    try {
      const clone = join(tmp, 'repo');
      const commit = await this.fetch(source, ref, clone);
      const found = discoverSkills(clone);
      if (!found.length) throw new Error('No SKILL.md found (looked in skills/<name>/, <name>/ and the repo root)');
      const staged = join(tmp, 'out');
      for (const s of found) copySkill(s.dir, join(staged, s.name), s.dir !== clone);
      const meta = metadata(clone);
      const lic = ['LICENSE', 'LICENSE.md', 'LICENSE.txt'].find(f => existsSync(join(clone, f)));
      if (lic) cpSync(join(clone, lic), join(staged, lic));
      const target = join(this.dir, id);
      if (relative(this.dir, target).startsWith('..')) throw new Error('Invalid package id');
      mkdirSync(this.dir, { recursive: true });
      rmSync(target, { recursive: true, force: true });
      cpSync(staged, target, { recursive: true }); // tmp may be on another volume, so no rename
      return { commit, ...meta, skills: found.map(s => s.name).sort() };
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  }
}

export function defaultId(source: string): string {
  const name = source.replace(/\.git$/, '').split(/[/:]/).filter(Boolean).at(-1) ?? '';
  const id = name.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  if (!id) throw new Error('Cannot derive a package id from the URL; give one');
  return id;
}
