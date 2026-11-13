/**
 * What the project picked in the sidebar shows on each page. `null` project = All projects (nothing hidden).
 * A list that is null (workflows, skills) or empty (workplaceIds) in the settings means "everything".
 */

interface ScopeSettings {
  workflows: string[] | null;
  skills: string[] | null;
  workplaceIds: string[];
  rules: { repositories: string[] };
}
interface ScopeProject {
  slug: string;
  settings: ScopeSettings;
}

export function workflowInScope(project: ScopeProject | null, workflowId: string): boolean {
  return !project?.settings.workflows || project.settings.workflows.includes(workflowId);
}

/** `path` is the skill's path as /api/skills lists it (what the project's skills list stores). */
export function skillInScope(project: ScopeProject | null, path: string): boolean {
  return !project?.settings.skills || project.settings.skills.includes(path);
}

/** Workplaces the project lists (all when it lists none), and the repositories holding one of them or named in its task rules. */
export function scopeRepoRegistry<R extends { id: string }, W extends { id: string; repositoryId: string }>(
  project: ScopeProject | null,
  view: { repositories: R[]; workplaces: W[] },
): { repositories: R[]; workplaces: W[] } {
  if (!project || !project.settings.workplaceIds.length) return view;
  const ids = project.settings.workplaceIds;
  const workplaces = view.workplaces.filter(w => ids.includes(w.id));
  const repoIds = new Set([...workplaces.map(w => w.repositoryId), ...project.settings.rules.repositories]);
  return { repositories: view.repositories.filter(r => repoIds.has(r.id)), workplaces };
}

const normPath = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
const isInside = (dir: string, root: string) => {
  const d = normPath(dir);
  const r = normPath(root);
  return d === r || d.startsWith(`${r}/`);
};

/** Folder of a folder-scoped MCP server (`local:<dir>`, `project:<dir>`); null for user-wide servers. */
export function mcpScopeDir(scope: string): string | null {
  const m = /^(?:local|project):(.+)$/.exec(scope);
  return m ? m[1]! : null;
}

/**
 * MCP servers shown for a project: user-wide ones, ones in its workplaces' folders, and ones in folders no other
 * project claims. Servers in another project's workplace folders are hidden. A project that lists no workplace sees all.
 */
export function mcpServerInScope(
  project: ScopeProject | null,
  projects: ScopeProject[],
  workplaces: { id: string; path: string }[],
  server: { scope: string },
): boolean {
  const dir = mcpScopeDir(server.scope);
  if (!project || !dir || !project.settings.workplaceIds.length) return true;
  const owns = (p: ScopeProject) => workplaces.some(w => p.settings.workplaceIds.includes(w.id) && isInside(dir, w.path));
  if (owns(project)) return true;
  return !projects.some(p => p.slug !== project.slug && owns(p));
}
