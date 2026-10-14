import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { findRepoRoot } from '@ot/config';
import { routingSchema, validateWorkflow, workflowSchema, type WorkflowDefinition, type WorkflowRouting } from '@ot/contracts';

export const sha = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 12);

/** workflows/<id>.workflow.json, your own files (gitignored; start from examples/workflows/); the hash identifies the version a run used. */
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

  /** Workflow ids whose file mentions `needle` (e.g. a skill path prefix). Used as the Skills module's usedBy port. */
  referencing(needle: string): string[] {
    if (!existsSync(this.dir)) return [];
    return readdirSync(this.dir)
      .filter(f => f.endsWith('.workflow.json') && readFileSync(join(this.dir, f), 'utf8').includes(needle))
      .map(f => f.replace(/\.workflow\.json$/, ''));
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
