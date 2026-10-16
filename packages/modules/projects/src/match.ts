import type { Project, TaskFacts } from '@tesserax/contracts';

/** The first project (by position) whose rules match the task; the default project when none does. */
export function matchTask(projects: Project[], task: TaskFacts): Project {
  const ordered = [...projects].sort((a, b) => a.position - b.position);
  const hit = ordered.find(p => {
    const r = p.settings.rules;
    return (
      (task.project != null && r.jiraKeys.includes(task.project)) ||
      r.sourceIds.includes(task.sourceId) ||
      (task.repositoryId != null && r.repositories.includes(task.repositoryId))
    );
  });
  const fallback = ordered.find(p => p.isDefault);
  if (hit) return hit;
  if (!fallback) throw new Error('There is no default project');
  return fallback;
}

const trim = (p: string) => (p.length > 1 ? p.replace(/\/+$/, '') : p);

/** The owner of the longest listed path that equals `cwd` or contains it (a sibling that shares a prefix does not match). */
export function matchPath(entries: { projectId: string; paths: string[] }[], cwd: string): string | null {
  const dir = trim(cwd);
  let best: { projectId: string; len: number } | null = null;
  for (const e of entries) {
    for (const raw of e.paths) {
      const p = trim(raw);
      if ((dir === p || dir.startsWith(`${p}/`)) && (!best || p.length > best.len)) best = { projectId: e.projectId, len: p.length };
    }
  }
  return best?.projectId ?? null;
}

/** Two projects must not claim the same Jira key or source; returns a message naming the other project, or null. */
export function findRuleConflict(others: Project[], settings: Project['settings']): string | null {
  for (const o of others) {
    const key = settings.rules.jiraKeys.find(k => o.settings.rules.jiraKeys.includes(k));
    if (key) return `Jira key ${key} is already used by project "${o.name}".`;
    const src = settings.rules.sourceIds.find(s => o.settings.rules.sourceIds.includes(s));
    if (src) return `That source is already used by project "${o.name}".`;
    const repo = settings.rules.repositories.find(r => o.settings.rules.repositories.includes(r));
    if (repo) return `Repository ${repo} is already used by project "${o.name}".`;
  }
  return null;
}
