import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, normalize, relative } from 'node:path';
import { parseSkill, sha } from './frontmatter';

export interface Skill {
  path: string;
  name: string;
  description: string;
  body: string;
  hash: string;
}

/** The host's own skills: <skillsDir>/<name>/SKILL.md (Claude Code skill format), referenced by path from rootDir. */
export class LocalSkillStore {
  constructor(readonly root: string, readonly skillsDir = 'skills') {}

  /** Only paths inside the skills folder. */
  private resolve(path: string): string {
    const abs = normalize(join(this.root, path));
    if (relative(join(this.root, this.skillsDir), abs).startsWith('..')) throw new Error(`Skill path outside ${this.skillsDir}/: ${path}`);
    return abs;
  }

  get(path: string): Skill {
    const abs = this.resolve(path);
    if (!existsSync(abs)) throw new Error(`Skill not found: ${path}`);
    const text = readFileSync(abs, 'utf8');
    return { path, ...parseSkill(text, path), hash: sha(text) };
  }

  pathOf(name: string): string {
    if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) throw new Error('Skill names use lowercase letters, digits and dashes');
    return `${this.skillsDir}/${name}/SKILL.md`;
  }

  read(name: string): { path: string; content: string; hash: string } {
    const path = this.pathOf(name);
    const abs = this.resolve(path);
    if (!existsSync(abs)) throw new Error(`Skill ${name} not found`);
    const content = readFileSync(abs, 'utf8');
    return { path, content, hash: sha(content) };
  }

  save(name: string, content: string, create = false): { path: string; hash: string } {
    const path = this.pathOf(name);
    const abs = this.resolve(path);
    if (create && existsSync(abs)) throw new Error(`Skill ${name} already exists`);
    if (!create && !existsSync(abs)) throw new Error(`Skill ${name} not found`);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(`${abs}.tmp`, content.endsWith('\n') ? content : `${content}\n`);
    renameSync(`${abs}.tmp`, abs);
    return { path, hash: sha(readFileSync(abs, 'utf8')) };
  }

  list(): Skill[] {
    const base = join(this.root, this.skillsDir);
    if (!existsSync(base)) return [];
    return readdirSync(base, { withFileTypes: true })
      .filter(d => d.isDirectory() && existsSync(join(base, d.name, 'SKILL.md')))
      .map(d => this.get(`${this.skillsDir}/${d.name}/SKILL.md`));
  }
}
