import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { ExternalLink, Pencil, Play, Plus, RefreshCw } from 'lucide-react';
import { TaskDialog } from '@/components/task-dialog';
import { useState } from 'react';
import type { TaskDetailDto, TaskList, TaskQuery } from '@ot/contracts';
import { Page, QueryState } from '@/components/page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/input';
import { Table, TBody, Td, Th, THead, Tr } from '@/components/ui/table';
import { api } from '@/lib/api';
import { timeAgo } from '@/lib/utils';

const CAT = {
  in_progress: { label: 'In progress', variant: 'blue' },
  todo: { label: 'To do', variant: 'default' },
  done: { label: 'Done', variant: 'green' },
} as const;

export function TasksPage() {
  const [f, setF] = useState<TaskQuery>({});
  const set = (k: keyof TaskQuery) => (v: string) => setF(prev => ({ ...prev, [k]: v || undefined }));
  const params = new URLSearchParams(Object.entries(f).filter(([, v]) => v) as [string, string][]);
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['tasks', f], queryFn: () => api<TaskList>(`/api/tasks?${params}`), refetchInterval: 30_000 });
  const sync = useMutation({
    mutationFn: () => api<{ queued: boolean }>('/api/tasks/sync', { method: 'POST' }),
    onSuccess: () => setTimeout(() => qc.invalidateQueries({ queryKey: ['tasks'] }), 4000),
  });
  const navigate = useNavigate();
  const [workflowId, setWorkflowId] = useState('');
  const workflows = useQuery({ queryKey: ['wf', 'list'], queryFn: () => api<{ id: string; name: string }[]>('/api/workflows') });
  const startWorkflow = useMutation({
    mutationFn: (taskId: string) =>
      api<{ runId: string; created: boolean }>(`/api/tasks/${taskId}/workflow-runs`, { method: 'POST', body: JSON.stringify(workflowId ? { workflowId } : {}) }),
    onSuccess: r => navigate({ to: '/runs/$runId', params: { runId: r.runId } }),
  });
  const runPipeline = useMutation({
    mutationFn: (taskId: string) => api<{ run: { id: string }; created: boolean }>(`/api/pipeline/tasks/${taskId}/runs`, { method: 'POST' }),
    onSuccess: r => navigate({ to: '/inbox', search: { run: r.run.id, group: 'all' } }),
  });
  const [dialog, setDialog] = useState<{ task?: TaskDetailDto } | null>(null);
  const openEdit = (id: string) => api<TaskDetailDto>(`/api/tasks/${id}`).then(task => setDialog({ task }));
  const d = q.data;
  const tasks = d?.tasks ?? [];

  return (
    <Page
      title="Tasks"
      description={
        d?.sources.length
          ? d.sources.map(s => (
              <span key={s.id} className="mr-3">
                {s.kind} · {s.name} ({s.workspace}): {s.taskCount} open, synced {timeAgo(s.lastSyncedAt)}
                {s.lastError && <span className="text-red-600"> · last error: {s.lastError}</span>}
              </span>
            ))
          : 'Read-only tasks from Jira Cloud.'
      }
      actions={
        <div className="flex gap-2">
          <Button size="sm" onClick={() => setDialog({})}><Plus className="size-3.5" />New task</Button>
          <Button variant="outline" size="sm" disabled={!d?.jiraConfigured || sync.isPending} onClick={() => sync.mutate()}>
            <RefreshCw className={`size-3.5 ${sync.isPending ? 'animate-spin' : ''}`} />Sync now
          </Button>
        </div>
      }
    >
      {d && !d.jiraConfigured && (
        <Card><CardContent className="pt-4 text-sm">
          Jira is not connected. Set <code>JIRA_BASE_URL</code> (e.g. https://your-site.atlassian.net), <code>JIRA_EMAIL</code> and <code>JIRA_API_TOKEN</code> in <code>open-tesseract/.env</code>, then restart <code>pnpm dev</code>. Tasks sync every ~2 minutes.
        </CardContent></Card>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Input placeholder="Search title, key, assignee…" className="w-64" value={f.q ?? ''} onChange={e => set('q')(e.target.value)} />
        <Select value={f.workspace ?? ''} onChange={e => set('workspace')(e.target.value)}>
          <option value="">All workspaces</option>
          <option value="personal">Personal</option>
          <option value="company">Company</option>
        </Select>
        <Select value={f.statusCategory ?? ''} onChange={e => set('statusCategory')(e.target.value)}>
          <option value="">Open (to do + in progress)</option>
          <option value="in_progress">In progress</option>
          <option value="todo">To do</option>
          <option value="done">Done</option>
        </Select>
        <Select value={f.project ?? ''} onChange={e => set('project')(e.target.value)}>
          <option value="">All projects</option>
          {d?.projects.map(p => <option key={p}>{p}</option>)}
        </Select>
        <Select value={workflowId} onChange={e => setWorkflowId(e.target.value)} title="Workflow used by “Start workflow”">
          <option value="">Workflow: by routing rules</option>
          {workflows.data?.map(w => <option key={w.id} value={w.id}>Workflow: {w.name}</option>)}
        </Select>
        <label className="flex items-center gap-1.5 text-sm">
          <input type="checkbox" checked={f.includeArchived === '1'} onChange={e => set('includeArchived')(e.target.checked ? '1' : '')} /> Show archived
        </label>
      </div>
      <Card>
        <QueryState isLoading={q.isLoading} error={q.error} empty={!q.isLoading && tasks.length === 0} emptyText="No tasks match." />
        {tasks.length > 0 && (
          <Table>
            <THead><Tr><Th>Key</Th><Th>Title</Th><Th>Status</Th><Th>Priority</Th><Th>Assignee</Th><Th>Due</Th><Th>Updated</Th><Th></Th></Tr></THead>
            <TBody>
              {tasks.map(t => (
                <Tr key={t.id} className={t.archived ? 'opacity-60' : ''}>
                  <Td className="whitespace-nowrap">
                    {t.url ? <a className="inline-flex items-center gap-1 font-medium hover:underline" href={t.url} target="_blank" rel="noreferrer">{t.key}<ExternalLink className="size-3" /></a> : <span className="font-medium">{t.key}</span>}
                    {t.source === 'local' && <div><Badge variant="outline">local</Badge></div>}
                  </Td>
                  <Td>
                    <div>{t.title}</div>
                    <div className="text-xs text-muted-foreground">{[t.type, t.project, t.workspace, ...t.labels].filter(Boolean).join(' · ')}{t.archived && ' · archived'}</div>
                  </Td>
                  <Td><Badge variant={CAT[t.statusCategory].variant}>{t.status ?? CAT[t.statusCategory].label}</Badge></Td>
                  <Td className="text-xs">{t.priority ?? '–'}</Td>
                  <Td className="text-xs whitespace-nowrap">{t.assignee ?? 'Unassigned'}</Td>
                  <Td className="text-xs whitespace-nowrap">{t.dueAt ?? '–'}</Td>
                  <Td className="text-xs whitespace-nowrap text-muted-foreground">{timeAgo(t.updatedAt)}</Td>
                  <Td>
                    <div className="flex gap-1">
                      {t.source === 'local' && <Button size="sm" variant="ghost" title="Edit" onClick={() => openEdit(t.id)}><Pencil className="size-3" /></Button>}
                      <Button size="sm" title="Start the workflow (analyze → spec → implement → test → review)" disabled={startWorkflow.isPending} onClick={() => startWorkflow.mutate(t.id)}>
                        <Play className="size-3" />Start workflow
                      </Button>
                      <Button size="sm" variant="ghost" title="Older pipeline: classify + playbook (Inbox)" disabled={runPipeline.isPending} onClick={() => runPipeline.mutate(t.id)}>
                        Pipeline
                      </Button>
                    </div>
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
      {dialog && <TaskDialog task={dialog.task} onClose={() => setDialog(null)} />}
    </Page>
  );
}
