import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import { findRepoRoot } from '@ot/config';
import { ISSUE_TYPES, type PlaybookDto, type TaskDetailDto } from '@ot/contracts';

const frontmatterSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string(),
  description: z.string().default(''),
  applies_to: z.array(z.enum(ISSUE_TYPES)).min(1),
  steps: z.array(z.string()).default([]),
  permission_mode: z.enum(['default', 'acceptEdits', 'plan', 'dontAsk']).default('default'),
  allowed_tools: z.array(z.string()).default(['Read', 'Grep', 'Glob']),
  makes_changes: z.boolean().default(false),
  max_budget_usd: z.number().positive().optional(),
});

export interface Playbook extends PlaybookDto {
  template: string;
  file: string;
  maxBudgetUsd?: number;
}

/** playbooks/*.md: YAML frontmatter (id, name, applies_to, steps, ...) + a prompt template body. */
export class PlaybookRegistry {
  constructor(readonly dir = join(findRepoRoot(), 'playbooks')) {}

  list(): Playbook[] {
    if (!existsSync(this.dir)) return [];
    const out: Playbook[] = [];
    for (const f of readdirSync(this.dir).filter(f => f.endsWith('.md')).sort()) {
      const file = join(this.dir, f);
      out.push(parsePlaybook(readFileSync(file, 'utf8'), file));
    }
    return out;
  }

  get(id: string): Playbook | null {
    return this.list().find(p => p.id === id) ?? null;
  }
}

export function parsePlaybook(text: string, file = '<inline>'): Playbook {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) throw new Error(`${file}: missing frontmatter`);
  const fm = frontmatterSchema.parse(parseYaml(m[1]!));
  return {
    id: fm.id,
    name: fm.name,
    description: fm.description,
    appliesTo: fm.applies_to,
    steps: fm.steps,
    permissionMode: fm.permission_mode,
    allowedTools: fm.allowed_tools,
    makesChanges: fm.makes_changes,
    maxBudgetUsd: fm.max_budget_usd,
    template: m[2]!.trim(),
    file,
  };
}

/** Fills {{placeholders}}. Issue text goes in as data inside <issue> tags; it never becomes instructions. */
export function renderPlaybook(p: Playbook, ctx: { task: TaskDetailDto; branch: string; repoPath: string; worktreePath: string; note?: string }): string {
  const t = ctx.task;
  const issue = [
    `key: ${t.key ?? ''}`,
    `title: ${t.title}`,
    `type: ${t.type ?? ''}`,
    `status: ${t.status ?? ''}`,
    `priority: ${t.priority ?? ''}`,
    `labels: ${t.labels.join(', ')}`,
    `components: ${t.components.join(', ')}`,
    `url: ${t.url ?? ''}`,
    '',
    'description:',
    t.description ?? '(none)',
    '',
    'comments:',
    ...(t.comments.length ? t.comments.map(c => `- ${c.author ?? '?'} (${c.created ?? ''}): ${c.body}`) : ['(none)']),
    '',
    'attachments (names only, not downloaded):',
    ...(t.attachments.length ? t.attachments.map(a => `- ${a.filename} (${a.mimeType ?? '?'}, ${a.size ?? '?'} bytes)`) : ['(none)']),
  ].join('\n');
  const vars: Record<string, string> = {
    issue_key: t.key ?? '',
    issue_title: t.title,
    issue_url: t.url ?? '',
    issue: `<issue>\n${issue.replace(/<\/?issue>/gi, '')}\n</issue>`,
    branch: ctx.branch,
    repo_path: ctx.repoPath,
    worktree_path: ctx.worktreePath,
    steps: p.steps.map((s, i) => `${i + 1}. ${s}`).join('\n'),
    user_note: ctx.note?.trim() || '(none)',
  };
  return p.template.replace(/\{\{\s*(\w+)\s*\}\}/g, (all, k: string) => vars[k] ?? all);
}
