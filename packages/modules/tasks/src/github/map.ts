import type { TaskStatusCategory } from '@tesserax/db';
import type { GithubIssue, GithubComment } from './client';

export interface MappedGithubTask {
  external_id: string;
  /** Short key displayed in the UI: "#123". */
  key: string;
  title: string;
  status: string;
  status_category: TaskStatusCategory;
  priority: null;
  assignee: string | null;
  reporter: string | null;
  /** The repo slug "owner/name" stored in tasks.project so two repos with #1 don't collide. */
  project: string;
  type: string;
  labels: string[];
  components: string[];
  description: string | null;
  parent: null;
  sprint: string | null;
  url: string;
  due_at: null;
  created_at_source: string;
  updated_at_source: string;
  raw: string;
}

/** Maps a raw GitHub issue object to the tasks row shape. */
export function mapIssue(issue: GithubIssue, repo: string): MappedGithubTask {
  const statusCategory: TaskStatusCategory = issue.state === 'closed' ? 'done' : 'todo';
  return {
    external_id: `${repo}#${issue.number}`,
    key: `#${issue.number}`,
    title: issue.title,
    status: issue.state,
    status_category: statusCategory,
    priority: null,
    assignee: issue.assignee?.login ?? null,
    reporter: issue.user?.login ?? null,
    project: repo,
    type: 'Issue',
    labels: issue.labels.map(l => l.name),
    components: [],
    description: issue.body ?? null,
    parent: null,
    sprint: issue.milestone?.title ?? null,
    url: issue.html_url,
    due_at: null,
    created_at_source: issue.created_at,
    updated_at_source: issue.updated_at,
    raw: JSON.stringify({ repo, number: issue.number, state: issue.state }),
  };
}

export interface MappedComment {
  author: string | null;
  created: string | null;
  body: string;
}

/** Maps raw GitHub comment objects to the shape used by tasks.comments. */
export function mapComments(comments: GithubComment[]): MappedComment[] {
  return comments.map(c => ({
    author: c.user?.login ?? null,
    created: c.created_at,
    body: c.body,
  }));
}
