import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, normalize, relative } from 'node:path';
import { findRepoRoot } from '@ot/config';
import { routingSchema, validateWorkflow, workflowSchema, type WorkflowDefinition, type WorkflowRouting } from '@ot/contracts';

export const sha = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 12);

/** workflows/<id>.workflow.json, versioned in git; the hash identifies the version a run used. */
export class WorkflowStore {
  constructor(readonly dir = join(findRepoRoot(), 'workflows')) {}

  list(): { id: string; name: string; hash: string; problems: string[] }[] {
    if (!existsSync(this.dir)) return [];
    return readdirSync(this.dir)
      .filter(f => f.endsWith('.workflow.json'))
      .sort()
      .map(f => {
        const id = f.replace(/\.workflow\.json$/, '');
        try {
          const { def, hash, problems } = this.load(id);
          return { id, name: def.name, hash, problems };
        } catch (e) {
          return { id, name: id, hash: '', problems: [(e as Error).message] };
        }
      });
  }

  load(id: string): { def: WorkflowDefinition; hash: string; problems: string[] } {
    if (!/^[a-z0-9][a-z0-9_-]*$/.test(id)) throw new Error(`Invalid workflow id ${id}`);
    const file = join(this.dir, `${id}.workflow.json`);
    if (!existsSync(file)) throw new Error(`Workflow ${id} not found in workflows/`);
    const text = readFileSync(file, 'utf8');
    const def = workflowSchema.parse(JSON.parse(text));
    return { def, hash: sha(text), problems: validateWorkflow(def) };
  }

  exists(id: string): boolean {
    return existsSync(join(this.dir, `${id}.workflow.json`));
  }

  /** Validates, then writes the file (pretty JSON, atomic). */
  save(def: WorkflowDefinition): { hash: string; problems: string[] } {
    const parsed = workflowSchema.parse(def);
    const problems = validateWorkflow(parsed);
    if (problems.length) return { hash: '', problems };
    const text = `${JSON.stringify(parsed, null, 2)}\n`;
    const file = join(this.dir, `${parsed.id}.workflow.json`);
    writeFileSync(`${file}.tmp`, text);
    renameSync(`${file}.tmp`, file);
    return { hash: sha(text), problems: [] };
  }
}

/** workflows/routing.json: which workflow a new ticket starts (first matching rule, else the default). */
export class RoutingStore {
  constructor(readonly file = join(findRepoRoot(), 'workflows', 'routing.json')) {}

  read(): WorkflowRouting {
    if (!existsSync(this.file)) return routingSchema.parse({});
    return routingSchema.parse(JSON.parse(readFileSync(this.file, 'utf8')));
  }

  save(r: WorkflowRouting, workflowExists: (id: string) => boolean): WorkflowRouting {
    const parsed = routingSchema.parse(r);
    for (const id of [parsed.default, ...parsed.rules.map(x => x.workflow)]) if (!workflowExists(id)) throw new Error(`Workflow ${id} does not exist`);
    writeFileSync(`${this.file}.tmp`, `${JSON.stringify(parsed, null, 2)}\n`);
    renameSync(`${this.file}.tmp`, this.file);
    return parsed;
  }
}

export interface Skill {
  path: string;
  name: string;
  description: string;
  body: string;
  hash: string;
}

/** SKILL.md files (Claude Code skill format: YAML frontmatter + body), referenced by path from the repo root. */
export class SkillStore {
  constructor(readonly root = findRepoRoot()) {}

  private resolve(path: string): string {
    const abs = normalize(join(this.root, path));
    if (relative(this.root, abs).startsWith('..')) throw new Error(`Skill path outside the repo: ${path}`);
    return abs;
  }

  get(path: string): Skill {
    const abs = this.resolve(path);
    if (!existsSync(abs)) throw new Error(`Skill not found: ${path}`);
    const text = readFileSync(abs, 'utf8');
    const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
    const fm = m?.[1] ?? '';
    const field = (k: string) => fm.match(new RegExp(`^${k}:\\s*(.+)$`, 'm'))?.[1]?.trim() ?? '';
    return { path, name: field('name') || path, description: field('description'), body: (m?.[2] ?? text).trim(), hash: sha(text) };
  }

  /** skills/<name>/SKILL.md */
  pathOf(name: string): string {
    if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) throw new Error('Skill names use lowercase letters, digits and dashes');
    return `skills/${name}/SKILL.md`;
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

  list(dir = 'skills'): Skill[] {
    const base = this.resolve(dir);
    if (!existsSync(base)) return [];
    return readdirSync(base, { withFileTypes: true })
      .filter(d => d.isDirectory() && existsSync(join(base, d.name, 'SKILL.md')))
      .map(d => this.get(`${dir}/${d.name}/SKILL.md`));
  }
}
