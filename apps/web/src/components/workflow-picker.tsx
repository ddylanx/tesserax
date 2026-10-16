import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { Play, X } from 'lucide-react';
import { useState } from 'react';
import { canSwitchWorkflow, conditionsMatch, type ConditionContext, type WorkflowRouting, type WorkflowRunDetail, type WorkflowRunList } from '@tesserax/contracts';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/input';
import { api } from '@/lib/api';
import { WorkplaceInfo, WorkplaceSelect, resolveWorkplace, useRepoRegistry } from '@/components/workplace';

type Issue = ConditionContext['issue'];
type TaskRef = Issue & { projectSlug?: string; id: string; key: string | null; title: string; source?: string; workplaceId?: string | null };

/** The workflows plus the routing rules of a project that suggest one per task. */
export function useWorkflowChoices(projectSlug?: string) {
  const workflows = useQuery({ queryKey: ['wf', 'list'], queryFn: () => api<{ id: string; name: string }[]>('/api/workflows') });
  const routing = useQuery({ queryKey: ['wf', 'routing', projectSlug ?? ''], queryFn: () => api<WorkflowRouting>(`/api/workflow-routing${projectSlug ? `?project=${encodeURIComponent(projectSlug)}` : ''}`) });
  return { workflows: workflows.data ?? [], routing: routing.data, isLoading: workflows.isLoading || routing.isLoading };
}

/** Same choice the server makes when no workflow is given: first matching rule, else the default. */
export function suggestWorkflow(routing: WorkflowRouting | undefined, issue: Issue): { id: string; rule: string | null } | null {
  if (!routing) return null;
  const rule = routing.rules.find(r => conditionsMatch(r.when, { issue }));
  return rule ? { id: rule.workflow, rule: rule.name || 'a routing rule' } : { id: routing.default, rule: null };
}

export function WorkflowSelect({ value, onChange, suggested, workflows, className }: {
  value: string; onChange: (id: string) => void; suggested?: string | null; workflows: { id: string; name: string }[]; className?: string;
}) {
  return (
    <Select value={value} onChange={e => onChange(e.target.value)} className={className}>
      {workflows.map(w => <option key={w.id} value={w.id}>{w.name}{w.id === suggested ? ' (suggested)' : ''}</option>)}
    </Select>
  );
}

/** "Start workflow" for one task: pick the workflow (the routing rules preselect one), then start. */
export function StartWorkflowDialog({ task, onClose }: { task: TaskRef; onClose: () => void }) {
  const { workflows, routing } = useWorkflowChoices(task.projectSlug);
  const suggestion = suggestWorkflow(routing, task);
  const [picked, setPicked] = useState<string | null>(null);
  const value = picked ?? suggestion?.id ?? workflows[0]?.id ?? '';
  const navigate = useNavigate();
  const qc = useQueryClient();
  // a task has one active run at a time: starting again would silently reopen that run
  const runs = useQuery({ queryKey: ['wf', 'runs', 'all'], queryFn: () => api<WorkflowRunList>('/api/workflow-runs?status=all') });
  const active = runs.data?.runs.find(r => r.task.id === task.id && ['running', 'waiting', 'failed'].includes(r.status));
  const open = (runId: string) => navigate({ to: '/runs/$runId', params: { runId } });
  const registry = useRepoRegistry();
  const [workplaceId, setWorkplaceId] = useState(task.workplaceId ?? '');
  const byProject = resolveWorkplace(registry.data, { project: task.project });
  const workplace = resolveWorkplace(registry.data, { project: task.project, workplaceId: workplaceId || null });
  const startRun = () => api<{ runId: string; created: boolean; workflowId: string }>(`/api/tasks/${task.id}/workflow-runs`, { method: 'POST', body: JSON.stringify({ workflowId: value }) });
  const start = useMutation({
    mutationFn: async (restart: boolean) => {
      if (workplaceId !== (task.workplaceId ?? '')) await api(`/api/tasks/${task.id}/workplace`, { method: 'PATCH', body: JSON.stringify({ workplaceId: workplaceId || null }) });
      if (restart && active) await api(`/api/workflow-runs/${active.id}/cancel`, { method: 'POST' });
      return startRun();
    },
    onSuccess: r => { qc.invalidateQueries({ queryKey: ['wf'] }); open(r.runId); },
  });
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" onMouseDown={onClose}>
      <div className="flex w-full max-w-md flex-col gap-3 rounded-xl border bg-card p-4 shadow-xl" onMouseDown={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="font-semibold">Start workflow · {task.key}</h3>
          <button className="rounded p-1 hover:bg-accent" onClick={onClose} title="Close"><X className="size-4" /></button>
        </div>
        <div className="truncate text-sm text-muted-foreground">{task.title}</div>
        {active && (
          <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs">
            {task.key} already has a run on <b>{active.workflowId}</b> ({active.status}{active.currentNodeLabel ? `, at “${active.currentNodeLabel}”` : ''}).
            Starting does not create a second run: it would reopen that one. To use the workflow below, cancel it and start again.
          </div>
        )}
        <label className="flex flex-col gap-1 text-xs">Workplace (repo checkout and brand)
          <WorkplaceSelect view={registry.data} value={workplaceId} onChange={setWorkplaceId} auto={byProject ? `${byProject.brand} (${task.project})` : null} />
          {registry.data && <WorkplaceInfo view={registry.data} w={workplace} />}
        </label>
        <label className="flex flex-col gap-1 text-xs">Workflow
          <WorkflowSelect value={value} onChange={setPicked} suggested={suggestion?.id} workflows={workflows} />
        </label>
        {suggestion && (
          <p className="text-xs text-muted-foreground">
            Suggested: <b>{suggestion.id}</b> {suggestion.rule ? `(rule “${suggestion.rule}”)` : '(default, no rule matched)'}. Rules are on the Workflows page.
          </p>
        )}
        {start.error && <p className="text-sm text-red-600">{(start.error as Error).message}</p>}
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Close</Button>
          {active ? (
            <>
              <Button variant="outline" onClick={() => open(active.id)}>Open the run</Button>
              <Button disabled={!value || start.isPending} onClick={() => confirm(`Cancel the current run of ${task.key} and start “${value}” from the beginning?`) && start.mutate(true)}>
                <Play className="size-3.5" />Cancel it and start again
              </Button>
            </>
          ) : (
            <Button disabled={!value || !workplace || start.isPending || runs.isLoading} onClick={() => start.mutate(false)}><Play className="size-3.5" />Start</Button>
          )}
        </div>
      </div>
    </div>
  );
}

export const canChangeWorkflow = (run: WorkflowRunDetail) => canSwitchWorkflow(run.status, run.nodeRuns);

/** Workflow picker on a run that has not got past its first step; switching cancels it and starts a new run. */
export function ChangeWorkflow({ run }: { run: WorkflowRunDetail }) {
  const { workflows } = useWorkflowChoices();
  const [value, setValue] = useState(run.workflowId);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const change = useMutation({
    mutationFn: () => api<{ runId: string }>(`/api/workflow-runs/${run.id}/workflow`, { method: 'POST', body: JSON.stringify({ workflowId: value }) }),
    onSuccess: r => { qc.invalidateQueries({ queryKey: ['wf'] }); navigate({ to: '/runs/$runId', params: { runId: r.runId } }); },
  });
  if (!canChangeWorkflow(run) || !workflows.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <span className="text-muted-foreground">Workflow</span>
      <WorkflowSelect value={value} onChange={setValue} workflows={workflows} className="h-8" />
      {value !== run.workflowId && (
        <Button size="sm" variant="outline" disabled={change.isPending}
          onClick={() => confirm(`Switch ${run.task.key} to “${value}”? This run is cancelled and a new one starts from the beginning.`) && change.mutate()}>
          Switch
        </Button>
      )}
      {change.error && <span className="text-red-600">{(change.error as Error).message}</span>}
    </div>
  );
}
