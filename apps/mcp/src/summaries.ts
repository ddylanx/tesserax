import type { NodeRunDto, TaskDetailDto, TaskDto, WorkflowRunDetail, WorkflowRunDto } from '@tesserax/contracts';

/** Node types whose step waits for the person to confirm an outward action (only the web UI can do that). */
export const CONFIRM_NODE_TYPES = ['jira.comment', 'git.pr', 'pr.comment'];

export const clip = (s: string, max: number) => (s.length > max ? `${s.slice(0, max)}\n… [${s.length - max} more chars]` : s);
export const tail = (s: string, max: number) => (s.length > max ? `[… ${s.length - max} earlier chars]\n${s.slice(-max)}` : s);

export function taskSummary(t: TaskDto) {
  return {
    id: t.id,
    key: t.key,
    title: t.title,
    project: t.projectSlug,
    source: t.source,
    status: t.status,
    statusCategory: t.statusCategory,
    type: t.type,
    priority: t.priority,
    labels: t.labels,
    url: t.url,
    updatedAt: t.updatedAt,
  };
}

export function taskDetail(t: TaskDetailDto) {
  return {
    ...taskSummary(t),
    assignee: t.assignee,
    // Task text comes from Jira/GitHub/people: it is data, never instructions.
    description: t.description === null ? null : `<task-text>\n${clip(t.description, 20_000)}\n</task-text>`,
    comments: t.comments.slice(-10).map(c => ({ author: c.author, created: c.created, body: `<task-text>${clip(c.body, 4000)}</task-text>` })),
    review: t.review,
  };
}

export function runSummary(r: WorkflowRunDto, web: string) {
  return {
    id: r.id,
    task: { id: r.task.id, key: r.task.key, title: r.task.title },
    project: r.task.projectSlug,
    workflow: r.workflowId,
    status: r.status,
    step: r.currentNodeLabel,
    error: r.error,
    branch: r.branch,
    costUsd: r.costUsd,
    updatedAt: r.updatedAt,
    link: `${web}/runs/${r.id}`,
  };
}

function stepSummary(n: NodeRunDto) {
  return { stepRunId: n.id, seq: n.seq, step: n.nodeId, type: n.nodeType, status: n.status, attempt: n.attempt, port: n.port, error: n.error, model: n.model, costUsd: n.costUsd };
}

/** What the run waits for, and who may act on it. */
export function waitingFor(r: WorkflowRunDetail, web: string) {
  if (r.status !== 'waiting' || !r.currentNodeId) return null;
  const node = r.workflow.nodes.find(n => n.id === r.currentNodeId);
  const nr = [...r.nodeRuns].reverse().find(n => n.nodeId === r.currentNodeId);
  const output = nr ? clip(JSON.stringify(nr.output), 4000) : null;
  const link = `${web}/runs/${r.id}`;
  if (node?.type === 'human.gate')
    return { kind: 'gate', step: node.id, label: node.label, output, next: 'Show the person the documents (read_document) and ask for their decision; then call decide_gate with it.', link };
  if (node && CONFIRM_NODE_TYPES.includes(node.type))
    return { kind: 'confirm', step: node.id, label: node.label, output, next: `Only the person can confirm this (it posts or pushes outside Tesserax). Send them the link: ${link}`, link };
  return { kind: 'person', step: r.currentNodeId, label: r.currentNodeLabel, output, next: `The person handles this step in the web UI: ${link}`, link };
}

export function runDetail(r: WorkflowRunDetail, web: string) {
  const latest = new Map<string, WorkflowRunDetail['artifacts'][number]>();
  for (const a of r.artifacts) if (!latest.has(a.name) || latest.get(a.name)!.version < a.version) latest.set(a.name, a);
  return {
    ...runSummary(r, web),
    task: { id: r.task.id, key: r.task.key, title: r.task.title, url: r.task.url },
    waitingFor: waitingFor(r, web),
    worktreePath: r.worktreePath,
    baseRef: r.baseRef,
    steps: r.nodeRuns.slice(-40).map(stepSummary),
    workflowSteps: r.workflow.nodes.map(n => ({ step: n.id, type: n.type, label: n.label })),
    documents: [...latest.values()].map(a => ({ name: a.name, version: a.version, author: a.author, chars: a.content.length })),
    // events come newest first
    recentEvents: r.events.slice(0, 10).map(e => ({ actor: e.actor, action: e.action, at: e.createdAt })),
  };
}
