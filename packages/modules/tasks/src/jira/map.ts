import type { TaskStatusCategory } from '@ot/db';
import type { JiraIssue } from './client';

export function statusCategory(key: string | undefined): TaskStatusCategory {
  if (key === 'done') return 'done';
  if (key === 'indeterminate') return 'in_progress';
  return 'todo'; // new, undefined
}

export interface MappedTask {
  external_id: string;
  key: string;
  title: string;
  status: string | null;
  status_category: TaskStatusCategory;
  priority: string | null;
  assignee: string | null;
  project: string | null;
  type: string | null;
  labels: string[];
  due_at: string | null;
  created_at_source: string | null;
  updated_at_source: string | null;
  raw: string;
}

export function mapIssue(issue: JiraIssue): MappedTask {
  const f = issue.fields ?? {};
  return {
    external_id: issue.id,
    key: issue.key,
    title: f.summary ?? issue.key,
    status: f.status?.name ?? null,
    status_category: statusCategory(f.status?.statusCategory?.key),
    priority: f.priority?.name ?? null,
    assignee: f.assignee?.displayName ?? null,
    project: f.project?.key ?? null,
    type: f.issuetype?.name ?? null,
    labels: f.labels ?? [],
    due_at: f.duedate ?? null,
    created_at_source: f.created ?? null,
    updated_at_source: f.updated ?? null,
    raw: JSON.stringify({ id: issue.id, key: issue.key, fields: f }),
  };
}
