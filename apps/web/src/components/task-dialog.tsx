import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { Trash2, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { LOCAL_TASK_TYPES, type CreateLocalTask, type TaskDetailDto } from '@ot/contracts';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/input';
import { api } from '@/lib/api';
import { suggestWorkflow, useWorkflowChoices } from '@/components/workflow-picker';

type Form = Omit<CreateLocalTask, 'labels' | 'review'> & {
  labels: string;
  statusCategory: 'todo' | 'in_progress' | 'done';
  sourceBranch: string;
  targetBranch: string;
  prUrl: string;
};

/** Create or edit a local task (Company or Personal). Code-review tasks also take the member's branch / PR. */
export function TaskDialog({ task, onClose, onCreated }: { task?: TaskDetailDto; onClose: () => void; onCreated?: (t: TaskDetailDto) => void }) {
  const qc = useQueryClient();
  const repos = useQuery({ queryKey: ['pipeline', 'repos'], queryFn: () => api<Record<string, unknown>>('/api/pipeline/repos') });
  const [f, setF] = useState<Form>(() => ({
    workspace: (task?.workspace as 'company' | 'personal') ?? 'company',
    title: task?.title ?? '',
    description: task?.description ?? '',
    type: (LOCAL_TASK_TYPES as readonly string[]).includes(task?.type ?? '') ? (task!.type as Form['type']) : 'Task',
    priority: (task?.priority as Form['priority']) ?? undefined,
    project: task?.project ?? '',
    labels: task?.labels.join(', ') ?? '',
    dueAt: task?.dueAt ?? undefined,
    statusCategory: task?.statusCategory ?? 'todo',
    sourceBranch: task?.review?.sourceBranch ?? '',
    targetBranch: task?.review?.targetBranch ?? '',
    prUrl: task?.review?.prUrl ?? '',
  }));
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF(prev => ({ ...prev, [k]: v }));
  const isReview = f.type === 'Code review';
  const body = () => ({
    ...(task ? {} : { workspace: f.workspace }),
    title: f.title.trim(),
    description: f.description || undefined,
    type: f.type,
    priority: f.priority || undefined,
    project: f.project || undefined,
    labels: f.labels.split(',').map(s => s.trim()).filter(Boolean),
    dueAt: f.dueAt || undefined,
    ...(task ? { statusCategory: f.statusCategory } : {}),
    review: isReview && f.sourceBranch.trim()
      ? { sourceBranch: f.sourceBranch.trim(), targetBranch: f.targetBranch.trim() || undefined, prUrl: f.prUrl.trim() || undefined }
      : task ? null : undefined,
  });
  // new tasks: optionally start a workflow right away (the routing rules suggest one)
  const { workflows, routing } = useWorkflowChoices();
  const suggested = suggestWorkflow(routing, { type: f.type, project: f.project, priority: f.priority, labels: body().labels })?.id ?? null;
  const [startWith, setStartWith] = useState('');
  const navigate = useNavigate();
  const save = useMutation({
    mutationFn: async () => {
      if (task) return { t: await api<TaskDetailDto>(`/api/tasks/${task.id}`, { method: 'PATCH', body: JSON.stringify(body()) }), runId: null };
      const t = await api<TaskDetailDto>('/api/tasks', { method: 'POST', body: JSON.stringify(body()) });
      const run = startWith
        ? await api<{ runId: string }>(`/api/tasks/${t.id}/workflow-runs`, { method: 'POST', body: JSON.stringify({ workflowId: startWith === 'suggested' ? suggested : startWith }) })
        : null;
      return { t, runId: run?.runId ?? null };
    },
    onSuccess: ({ t, runId }) => {
      qc.invalidateQueries({ queryKey: ['tasks'] });
      onCreated?.(t);
      onClose();
      if (runId) navigate({ to: '/runs/$runId', params: { runId } });
    },
  });
  const remove = useMutation({
    mutationFn: () => api(`/api/tasks/${task!.id}`, { method: 'DELETE' }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['tasks'] }); onClose(); },
  });
  const repoMap = (repos.data ?? {}) as Record<string, { path?: string }>;
  const projects = Object.keys(repoMap);
  const repoName = (k: string) => `${k} → ${(repoMap[k]?.path ?? '').split('/').filter(Boolean).at(-1) ?? ''}`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" onMouseDown={onClose}>
      <div className="flex max-h-[92vh] w-full max-w-xl flex-col gap-3 overflow-y-auto rounded-xl border bg-card p-4 shadow-xl" onMouseDown={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="font-semibold">{task ? `Edit ${task.key}` : 'New task'}</h3>
          <button className="rounded p-1 hover:bg-accent" onClick={onClose} title="Close"><X className="size-4" /></button>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          {!task && (
            <label className="flex flex-col gap-1 text-xs">Workspace
              <Select value={f.workspace} onChange={e => set('workspace', e.target.value as Form['workspace'])}>
                <option value="company">Company</option>
                <option value="personal">Personal</option>
              </Select>
            </label>
          )}
          <label className="flex flex-col gap-1 text-xs">Type
            <Select value={f.type} onChange={e => set('type', e.target.value as Form['type'])}>
              {LOCAL_TASK_TYPES.map(t => <option key={t}>{t}</option>)}
            </Select>
          </label>
          <label className="flex flex-col gap-1 text-xs sm:col-span-2">Title
            <Input autoFocus value={f.title} onChange={e => set('title', e.target.value)} placeholder={isReview ? 'Review PR: …' : 'What needs to be done'} />
          </label>
          <label className="flex flex-col gap-1 text-xs sm:col-span-2">Description
            <textarea className="min-h-28 rounded-md border bg-background p-2 text-sm" value={f.description ?? ''} onChange={e => set('description', e.target.value)}
              placeholder={isReview ? 'What the PR should do, what to focus on…' : 'Context, expected behaviour, acceptance criteria…'} />
          </label>
          <label className="flex flex-col gap-1 text-xs">Repo (required)
            <Select value={f.project ?? ''} onChange={e => set('project', e.target.value)}>
              <option value="">Choose the repo…</option>
              {projects.map(p => <option key={p} value={p}>{repoName(p)}</option>)}
            </Select>
          </label>
          <label className="flex flex-col gap-1 text-xs">Priority
            <Select value={f.priority ?? ''} onChange={e => set('priority', (e.target.value || undefined) as Form['priority'])}>
              <option value="">–</option>
              {['Highest', 'High', 'Medium', 'Low', 'Lowest'].map(p => <option key={p}>{p}</option>)}
            </Select>
          </label>
          <label className="flex flex-col gap-1 text-xs">Labels (comma separated)
            <Input value={f.labels} onChange={e => set('labels', e.target.value)} />
          </label>
          <label className="flex flex-col gap-1 text-xs">Due
            <Input type="date" value={f.dueAt ?? ''} onChange={e => set('dueAt', e.target.value || undefined)} />
          </label>
          {task && (
            <label className="flex flex-col gap-1 text-xs">Status
              <Select value={f.statusCategory} onChange={e => set('statusCategory', e.target.value as Form['statusCategory'])}>
                <option value="todo">To Do</option>
                <option value="in_progress">In Progress</option>
                <option value="done">Done</option>
              </Select>
            </label>
          )}
          {!task && (
            <label className="flex flex-col gap-1 text-xs sm:col-span-2">After creating
              <Select value={startWith} onChange={e => setStartWith(e.target.value)}>
                <option value="">Don't start a workflow yet</option>
                {suggested && <option value="suggested">Start workflow: {workflows.find(w => w.id === suggested)?.name ?? suggested} (suggested by rules)</option>}
                {workflows.filter(w => w.id !== suggested).map(w => <option key={w.id} value={w.id}>Start workflow: {w.name}</option>)}
              </Select>
            </label>
          )}
          {isReview && (
            <div className="flex flex-col gap-2 rounded-md border p-2 sm:col-span-2">
              <div className="text-xs font-medium">Pull request to review</div>
              <label className="flex flex-col gap-1 text-xs">Member's branch (required)
                <Input value={f.sourceBranch} onChange={e => set('sourceBranch', e.target.value)} placeholder="feature/PROJ-1234-something" />
              </label>
              <label className="flex flex-col gap-1 text-xs">Target branch (empty = the project's base, e.g. develop)
                <Input value={f.targetBranch} onChange={e => set('targetBranch', e.target.value)} placeholder="develop" />
              </label>
              <label className="flex flex-col gap-1 text-xs">PR link (optional, to post the review there)
                <Input value={f.prUrl} onChange={e => set('prUrl', e.target.value)} placeholder="https://bitbucket.org/acme/…/pull-requests/123" />
              </label>
            </div>
          )}
        </div>
        {(save.error || remove.error) && <p className="text-sm text-red-600">{((save.error ?? remove.error) as Error).message}</p>}
        <div className="flex items-center justify-between gap-2">
          {task ? (
            <Button variant="ghost" onClick={() => confirm(`Delete ${task.key}? Its runs are deleted too.`) && remove.mutate()}><Trash2 className="size-3.5" />Delete</Button>
          ) : <span />}
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button disabled={!f.title.trim() || !f.project || (isReview && !f.sourceBranch.trim()) || save.isPending} onClick={() => save.mutate()}>{task ? 'Save' : 'Create task'}</Button>
          </div>
        </div>
      </div>
    </div>
  );
}
