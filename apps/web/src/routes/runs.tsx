import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import type { TaskDetailDto, WorkflowRunDto, WorkflowRunList } from '@tesserax/contracts';
import { CheckCircle2, ExternalLink, FileText, RotateCcw, Search, Square, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { OnboardingChecklist } from '@/components/onboarding-checklist';
import { Page, QueryState } from '@/components/page';
import { TaskDialog } from '@/components/task-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/input';
import { Table, TBody, Td, Th, THead, Tr } from '@/components/ui/table';
import { api } from '@/lib/api';
import { ProjectDot, useProjectScope } from '@/lib/project-context';
import { timeAgo } from '@/lib/utils';

export const RUN_STATUS: Record<string, { label: string; variant: 'green' | 'amber' | 'blue' | 'red' | 'outline' }> = {
  waiting: { label: 'waiting for you', variant: 'amber' },
  running: { label: 'running', variant: 'blue' },
  failed: { label: 'failed', variant: 'red' },
  done: { label: 'done', variant: 'green' },
  cancelled: { label: 'cancelled', variant: 'outline' },
};

const STATUSES = ['waiting', 'running', 'failed', 'done', 'cancelled'] as const;
/** Shown when the URL names no status: everything not finished yet. */
const OPEN = ['waiting', 'running', 'failed'];

const canCancel = (r: WorkflowRunDto) => ['running', 'waiting', 'failed'].includes(r.status);
const canRetry = (r: WorkflowRunDto) => r.status === 'failed';
/** Local tasks only: Jira tasks get their status from Jira. */
const canMarkDone = (r: WorkflowRunDto) => r.task.source === 'local' && r.task.statusCategory !== 'done' && r.status === 'done';

type RunsSearch = { status?: string; workflow?: string; q?: string; onboarding?: string };

export function RunsPage() {
  const search = useSearch({ strict: false }) as RunsSearch;
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { scopeParam, selected: scopeSelected } = useProjectScope();

  const statusParam = search.status ?? OPEN.join(',');
  const statuses = statusParam === 'all' ? [] : statusParam.split(',').filter(Boolean);
  const workflow = search.workflow ?? '';
  const setSearch = (patch: Partial<RunsSearch>) =>
    navigate({ to: '/runs', search: ((prev: RunsSearch) => ({ ...prev, ...patch, onboarding: undefined })) as never, replace: true });

  // typing updates the URL after a short pause
  const [text, setText] = useState(search.q ?? '');
  useEffect(() => setText(search.q ?? ''), [search.q]);
  useEffect(() => {
    if (text === (search.q ?? '')) return;
    const t = setTimeout(() => setSearch({ q: text || undefined }), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);

  const params = new URLSearchParams({ status: statuses.length ? statuses.join(',') : 'all' });
  if (workflow) params.set('workflow', workflow);
  if (search.q) params.set('q', search.q);
  const qs = `${params.toString()}${scopeParam ? `&${scopeParam}` : ''}`;
  const q = useQuery({ queryKey: ['wf', 'runs', qs], queryFn: () => api<WorkflowRunList>(`/api/workflow-runs?${qs}`), refetchInterval: 4000, placeholderData: keepPreviousData });
  const counts = q.data?.counts ?? {};
  const runs = q.data?.runs ?? [];
  // older API builds do not send the list yet
  const workflows = q.data?.workflows ?? Array.from(new Set(runs.map(r => r.workflowId))).sort();
  const totalRuns = Object.values(counts).reduce((a, b) => a + b, 0);
  const filtered = !!(search.status || workflow || search.q);
  const showOnboarding = !q.isLoading && ((totalRuns === 0 && !filtered) || search.onboarding === '1');

  const toggle = (s: string) => {
    const next = statuses.includes(s) ? statuses.filter(x => x !== s) : [...statuses, s];
    setSearch({ status: next.length ? STATUSES.filter(x => next.includes(x)).join(',') : 'all' });
  };
  const isOpenPreset = statuses.length === OPEN.length && OPEN.every(s => statuses.includes(s));

  // ---- actions ----
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const visible = useMemo(() => new Set(runs.map(r => r.id)), [runs]);
  const picked = runs.filter(r => selected.has(r.id));
  useEffect(() => {
    // drop selections that left the list (filter changed, run moved on)
    setSelected(prev => (Array.from(prev).every(id => visible.has(id)) ? prev : new Set(Array.from(prev).filter(id => visible.has(id)))));
  }, [visible]);

  const [actionError, setActionError] = useState<string | null>(null);
  const act = useMutation({
    mutationFn: async ({ kind, list }: { kind: 'cancel' | 'retry' | 'done'; list: WorkflowRunDto[] }) => {
      const results = await Promise.allSettled(
        list.map(r =>
          kind === 'done'
            ? api(`/api/tasks/${r.task.id}/status`, { method: 'PATCH', body: JSON.stringify({ statusCategory: 'done' }) })
            : api(`/api/workflow-runs/${r.id}/${kind}`, { method: 'POST', body: '{}' }),
        ),
      );
      const failed = results.flatMap((x, i) => (x.status === 'rejected' ? [`${list[i]!.task.key}: ${(x.reason as Error).message}`] : []));
      if (failed.length) throw new Error(failed.join('\n'));
    },
    onMutate: () => setActionError(null),
    onError: e => setActionError((e as Error).message),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['wf', 'runs'] });
      qc.invalidateQueries({ queryKey: ['tasks'] });
    },
  });
  const run = (kind: 'cancel' | 'retry' | 'done', list: WorkflowRunDto[]) => {
    if (!list.length) return;
    if (kind === 'cancel' && !confirm(list.length === 1 ? `Cancel the run of ${list[0]!.task.key}? A running agent is stopped.` : `Cancel ${list.length} runs? Running agents are stopped.`)) return;
    act.mutate({ kind, list }, { onSuccess: () => setSelected(new Set()) });
  };

  const [dialog, setDialog] = useState<TaskDetailDto | null>(null);
  const openTask = async (r: WorkflowRunDto) => {
    try {
      setDialog(await api<TaskDetailDto>(`/api/tasks/${r.task.id}`));
    } catch (e) {
      setActionError((e as Error).message);
    }
  };

  const allPicked = runs.length > 0 && runs.every(r => selected.has(r.id));
  const bulk = { cancel: picked.filter(canCancel), retry: picked.filter(canRetry), done: picked.filter(canMarkDone) };

  return (
    <Page title="Runs" description="Each ticket moves through the workflow's nodes; gates wait for you.">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1">
          <Button size="sm" variant={isOpenPreset ? 'default' : 'outline'} onClick={() => setSearch({ status: undefined })} title="Waiting, running and failed">
            Open <span className="opacity-60">{OPEN.reduce((a, s) => a + (counts[s] ?? 0), 0)}</span>
          </Button>
          <span className="mx-1 w-px self-stretch bg-border" />
          {STATUSES.map(s => (
            <Button key={s} size="sm" variant={statuses.includes(s) ? 'default' : 'outline'} onClick={() => toggle(s)} aria-pressed={statuses.includes(s)}>
              {RUN_STATUS[s]!.label} <span className="opacity-60">{counts[s] ?? 0}</span>
            </Button>
          ))}
          <Button size="sm" variant={statuses.length === 0 ? 'default' : 'outline'} onClick={() => setSearch({ status: 'all' })}>
            All <span className="opacity-60">{totalRuns}</span>
          </Button>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Select value={workflow} onChange={e => setSearch({ workflow: e.target.value || undefined })} aria-label="Workflow">
            <option value="">All workflows</option>
            {workflow && !workflows.includes(workflow) && <option value={workflow}>{workflow}</option>}
            {workflows.map(w => <option key={w} value={w}>{w}</option>)}
          </Select>
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input value={text} onChange={e => setText(e.target.value)} placeholder="Ticket key or title" className="w-56 pl-7" aria-label="Search runs" />
          </div>
          {filtered && (
            <Button size="sm" variant="ghost" onClick={() => { setText(''); navigate({ to: '/runs', search: {} as never, replace: true }); }}>
              <X className="size-3.5" />Reset
            </Button>
          )}
        </div>
      </div>

      {picked.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border bg-accent/40 px-3 py-1.5 text-sm">
          <span>{picked.length} selected</span>
          {bulk.retry.length > 0 && <Button size="sm" variant="outline" disabled={act.isPending} onClick={() => run('retry', bulk.retry)}><RotateCcw className="size-3.5" />Retry {bulk.retry.length}</Button>}
          {bulk.cancel.length > 0 && <Button size="sm" variant="outline" disabled={act.isPending} onClick={() => run('cancel', bulk.cancel)}><Square className="size-3.5" />Cancel {bulk.cancel.length}</Button>}
          {bulk.done.length > 0 && <Button size="sm" variant="outline" disabled={act.isPending} onClick={() => run('done', bulk.done)}><CheckCircle2 className="size-3.5" />Mark {bulk.done.length} task{bulk.done.length > 1 ? 's' : ''} done</Button>}
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>Clear</Button>
        </div>
      )}
      {actionError && <p className="whitespace-pre-line text-sm text-destructive">{actionError}</p>}

      {showOnboarding ? (
        <OnboardingChecklist totalRuns={totalRuns} onClose={() => setSearch({})} />
      ) : (
        <Card>
          <QueryState isLoading={q.isLoading} error={q.error} empty={!q.isLoading && runs.length === 0}
            emptyText={filtered || totalRuns > 0
              ? 'No runs match these filters.'
              : 'No runs here. Start one with “Start workflow” on the Tasks page (you pick the workflow); new Jira issues start the one the routing rules suggest, and you can switch it on the run until its first step finishes.'} />
          {runs.length > 0 && (
            <Table>
              <THead>
                <Tr>
                  <Th className="w-8">
                    <input type="checkbox" checked={allPicked} aria-label="Select all"
                      onChange={() => setSelected(allPicked ? new Set() : new Set(runs.map(r => r.id)))} />
                  </Th>
                  <Th>Ticket</Th><Th>Workflow</Th><Th>Status</Th><Th>Current step</Th><Th>Updated</Th><Th className="text-right">Actions</Th>
                </Tr>
              </THead>
              <TBody>
                {runs.map(r => (
                  <Tr key={r.id} className={selected.has(r.id) ? 'bg-accent/40' : undefined}>
                    <Td>
                      <input type="checkbox" checked={selected.has(r.id)} aria-label={`Select ${r.task.key}`}
                        onChange={() => setSelected(prev => { const n = new Set(prev); if (n.has(r.id)) n.delete(r.id); else n.add(r.id); return n; })} />
                    </Td>
                    <Td>
                      <span className="inline-flex items-center gap-1.5">
                        {!scopeSelected && <ProjectDot color={r.task.projectColor} name={r.task.projectSlug} />}
                        <Link to="/runs/$runId" params={{ runId: r.id }} className="font-medium hover:underline">{r.task.key}</Link>
                        {r.task.statusCategory === 'done' && <span className="text-xs text-success" title={`Task status: ${r.task.status ?? 'done'}`}>task done</span>}
                      </span>
                      <div className="max-w-xs truncate text-xs text-muted-foreground" title={r.task.title}>{r.task.title}</div>
                    </Td>
                    <Td className="text-xs whitespace-nowrap">
                      <button type="button" className="hover:underline" title="Show only this workflow" onClick={() => setSearch({ workflow: r.workflowId })}>{r.workflowId}</button>
                    </Td>
                    <Td><Badge variant={RUN_STATUS[r.status]?.variant ?? 'outline'}>{RUN_STATUS[r.status]?.label ?? r.status}</Badge></Td>
                    <Td className="max-w-[14rem] text-xs">{r.currentNodeLabel ?? '–'}{r.error && <div className="truncate text-destructive" title={r.error}>{r.error}</div>}</Td>
                    <Td className="text-xs whitespace-nowrap text-muted-foreground">{timeAgo(r.updatedAt)}<div>${r.costUsd.toFixed(2)}</div></Td>
                    <Td>
                      <div className="flex justify-end gap-1 whitespace-nowrap">
                        {canRetry(r) && <Button size="sm" variant="outline" disabled={act.isPending} onClick={() => run('retry', [r])} title="Run the failed step again"><RotateCcw className="size-3.5" />Retry</Button>}
                        {canMarkDone(r) && <Button size="sm" variant="outline" disabled={act.isPending} onClick={() => run('done', [r])} title="Move the task to Done"><CheckCircle2 className="size-3.5" />Mark done</Button>}
                        {canCancel(r) && <Button size="sm" variant="ghost" disabled={act.isPending} onClick={() => run('cancel', [r])} title="Cancel this run (a running agent is stopped)"><Square className="size-3.5" />Cancel</Button>}
                        {r.task.source === 'local'
                          ? <Button size="sm" variant="ghost" onClick={() => openTask(r)} title="Open the task"><FileText className="size-3.5" /></Button>
                          : r.task.url && <a href={r.task.url} target="_blank" rel="noreferrer" title="Open in Jira" className="inline-flex h-7 items-center rounded-md px-2 hover:bg-accent"><ExternalLink className="size-3.5" /></a>}
                      </div>
                    </Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          )}
        </Card>
      )}
      {dialog && <TaskDialog task={dialog} onClose={() => { setDialog(null); qc.invalidateQueries({ queryKey: ['wf', 'runs'] }); }} />}
    </Page>
  );
}
