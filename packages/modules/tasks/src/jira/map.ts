import type { TaskStatusCategory } from '@tesserax/db';
import { richText } from './adf';
import type { JiraIssue } from './client';

export function statusCategory(key: string | undefined): TaskStatusCategory {
  if (key === 'done') return 'done';
  if (key === 'indeterminate') return 'in_progress';
  return 'todo';
}

/** Sprint field value (array of sprints, or strings in older formats) -> active sprint, else the latest. Ported from agent-cockpit. */
export function pickSprint(v: unknown): string | null {
  const list = Array.isArray(v) ? v : v ? [v] : [];
  const parsed = list
    .map(s =>
      typeof s === 'string'
        ? { name: s.match(/name=([^,\]]+)/)?.[1] ?? null, state: (s.match(/state=([^,\]]+)/)?.[1] ?? '').toLowerCase() }
        : { name: (s as { name?: string })?.name ?? null, state: String((s as { state?: string })?.state ?? '').toLowerCase() },
    )
    .filter(s => s.name);
  return (parsed.find(s => s.state === 'active') ?? parsed.at(-1))?.name ?? null;
}

export interface MappedTask {
  external_id: string;
  key: string;
  title: string;
  status: string | null;
  status_category: TaskStatusCategory;
  priority: string | null;
  assignee: string | null;
  reporter: string | null;
  project: string | null;
  type: string | null;
  labels: string[];
  components: string[];
  description: string | null;
  parent: string | null;
  sprint: string | null;
  due_at: string | null;
  created_at_source: string | null;
  updated_at_source: string | null;
  raw: string;
}

export function mapIssue(issue: JiraIssue, sprintField?: string | null): MappedTask {
  const f = issue.fields ?? {};
  return {
    external_id: issue.id,
    key: issue.key,
    title: f.summary ?? issue.key,
    status: f.status?.name ?? null,
    status_category: statusCategory(f.status?.statusCategory?.key),
    priority: f.priority?.name ?? null,
    assignee: f.assignee?.displayName ?? null,
    reporter: f.reporter?.displayName ?? null,
    project: f.project?.key ?? null,
    type: f.issuetype?.name ?? null,
    labels: f.labels ?? [],
    components: ((f.components ?? []) as Array<{ name?: string }>).map(c => c.name ?? '').filter(Boolean),
    description: richText(f.description),
    parent: f.parent ? `${f.parent.key}${f.parent.fields?.summary ? ` ${f.parent.fields.summary}` : ''}` : null,
    sprint: sprintField ? pickSprint(f[sprintField]) : null,
    due_at: f.duedate ?? null,
    created_at_source: f.created ?? null,
    updated_at_source: f.updated ?? null,
    raw: JSON.stringify({ id: issue.id, key: issue.key, project: f.project?.key, issuetype: f.issuetype?.name }),
  };
}

export interface IssueComment {
  author: string | null;
  created: string | null;
  body: string;
}
export interface IssueAttachment {
  filename: string;
  mimeType: string | null;
  size: number | null;
  created: string | null;
  author: string | null;
}

/** Comments (last 20, plain text) and attachment metadata (never the files). */
export function mapDetail(issue: JiraIssue): { comments: IssueComment[]; attachments: IssueAttachment[] } {
  const f = issue.fields ?? {};
  const comments = ((f.comment?.comments ?? []) as any[]).slice(-20).map(c => ({
    author: c.author?.displayName ?? null,
    created: c.created ?? null,
    body: richText(c.body, 2000) ?? '',
  }));
  const attachments = ((f.attachment ?? []) as any[]).map(a => ({
    filename: String(a.filename ?? ''),
    mimeType: a.mimeType ?? null,
    size: typeof a.size === 'number' ? a.size : null,
    created: a.created ?? null,
    author: a.author?.displayName ?? null,
  }));
  return { comments, attachments };
}
