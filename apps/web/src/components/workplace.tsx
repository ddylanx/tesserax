import { useQuery } from '@tanstack/react-query';
import type { RepoRegistryView } from '@ot/contracts';
import { Select } from '@/components/ui/input';
import { api } from '@/lib/api';

export type WorkplaceView = RepoRegistryView['workplaces'][number];

export function useRepoRegistry() {
  return useQuery({ queryKey: ['repos'], queryFn: () => api<RepoRegistryView>('/api/repos') });
}

export const repoOf = (view: RepoRegistryView | undefined, w: WorkplaceView | undefined | null) =>
  w ? view?.repositories.find(r => r.id === w.repositoryId) : undefined;

/** Same rule as the server: the workplace picked on the task, else the first registered for its project. */
export function resolveWorkplace(view: RepoRegistryView | undefined, task: { project?: string | null; workplaceId?: string | null }) {
  if (!view) return null;
  return (task.workplaceId && view.workplaces.find(w => w.id === task.workplaceId))
    || (task.project ? view.workplaces.find(w => w.projects.includes(task.project!)) : undefined)
    || null;
}

export const workplaceLabel = (view: RepoRegistryView | undefined, w: WorkplaceView) =>
  `${w.brand} · ${repoOf(view, w)?.name ?? w.repositoryId} — ${w.path.split('/').filter(Boolean).slice(-2).join('/')}`;

/** Workplace picker. `auto` adds a first option that means "by the task's project". */
export function WorkplaceSelect({ view, value, onChange, auto, required }: {
  view: RepoRegistryView | undefined; value: string; onChange: (id: string) => void; auto?: string | null; required?: boolean;
}) {
  return (
    <Select value={value} onChange={e => onChange(e.target.value)}>
      {auto !== undefined ? <option value="">{auto ? `By project: ${auto}` : 'By project (none registered)'}</option> : required ? <option value="">Choose the workplace…</option> : null}
      {view?.repositories.map(r => (
        <optgroup key={r.id} label={`${r.name}${r.origin ? `  (${r.origin})` : ''}`}>
          {view.workplaces.filter(w => w.repositoryId === r.id).map(w => <option key={w.id} value={w.id}>{workplaceLabel(view, w)}</option>)}
        </optgroup>
      ))}
    </Select>
  );
}

/** One line under a picker: where the work really happens. */
export function WorkplaceInfo({ view, w }: { view: RepoRegistryView | undefined; w: WorkplaceView | null }) {
  if (!w) return <span className="text-amber-600">No workplace: register the repo on the Repos page, or the run cannot create a worktree.</span>;
  const repo = repoOf(view, w);
  return (
    <span className="text-muted-foreground">
      <b className="text-foreground">{w.brand}</b> · {repo?.name} · <code>{w.path}</code>
      {repo?.origin && <> · origin <code>{repo.origin}</code></>}
      {!w.status.exists && <span className="text-red-600"> · folder missing</span>}
      {w.status.originMatches === false && <span className="text-red-600"> · this checkout's origin is {w.status.origin}</span>}
    </span>
  );
}
