import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { Plus, Save, X } from 'lucide-react';
import type { WorkflowRouting } from '@tesserax/contracts';
import { ConditionEditor } from '@/components/conditions';
import { useState } from 'react';
import { Page, QueryState } from '@/components/page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/input';
import { api } from '@/lib/api';
import { useProjectScope } from '@/lib/project-context';

export function WorkflowsPage() {
  const scope = useProjectScope();
  const q = useQuery({ queryKey: ['wf', 'list'], queryFn: () => api<{ id: string; name: string; hash: string; problems: string[] }[]>('/api/workflows') });
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [id, setId] = useState('');
  const create = useMutation({
    mutationFn: () => api<{ id: string }>('/api/workflows', { method: 'POST', body: JSON.stringify({ id, copyFrom: 'default' }) }),
    onSuccess: r => { qc.invalidateQueries({ queryKey: ['wf', 'list'] }); navigate({ to: '/workflows/$workflowId', params: { workflowId: r.id } }); },
  });
  return (
    <Page title="Workflows" description="Graphs of nodes stored in workflows/*.workflow.json. Runs use the default workflow.">
      <Card>
        <QueryState isLoading={q.isLoading} error={q.error} empty={q.data?.length === 0} />
        <ul className="divide-y">
          {q.data?.map(w => (
            <li key={w.id} className="flex items-center justify-between gap-2 px-4 py-3">
              <div>
                <Link to="/workflows/$workflowId" params={{ workflowId: w.id }} className="font-medium hover:underline">{w.name}</Link>
                <div className="text-xs text-muted-foreground"><code>{w.id}</code> · version {w.hash.slice(0, 7)}</div>
              </div>
              {w.problems.length ? <Badge variant="red">{w.problems.length} problems</Badge> : <Badge variant="green">valid</Badge>}
            </li>
          ))}
        </ul>
      </Card>
      <Card>
        <CardContent className="flex flex-wrap items-center gap-2 pt-4 text-sm">
          New workflow (copy of default):
          <Input className="w-56" placeholder="id, e.g. bugfix" value={id} onChange={e => setId(e.target.value.toLowerCase())} />
          <Button size="sm" disabled={!id || create.isPending} onClick={() => create.mutate()}><Plus className="size-3.5" />Create</Button>
          {create.error && <span className="text-red-600">{(create.error as Error).message}</span>}
        </CardContent>
      </Card>
      {q.data && <RoutingEditor key={scope.selected} project={scope.selected} workflows={q.data.map(w => ({ id: w.id, name: w.name }))} />}
    </Page>
  );
}

/** Routing of the project picked in the top bar (the default project in All): which workflow a ticket starts; first matching rule wins. */
function RoutingEditor({ workflows, project }: { workflows: { id: string; name: string }[]; project: string }) {
  const qc = useQueryClient();
  const suffix = project ? `?project=${encodeURIComponent(project)}` : '';
  const q = useQuery({ queryKey: ['wf', 'routing', project], queryFn: () => api<WorkflowRouting>(`/api/workflow-routing${suffix}`) });
  const [draft, setDraft] = useState<WorkflowRouting | null>(null);
  const r = draft ?? q.data;
  const save = useMutation({
    mutationFn: () => api(`/api/workflow-routing${suffix}`, { method: 'PUT', body: JSON.stringify(r) }),
    onSuccess: () => { setDraft(null); qc.invalidateQueries({ queryKey: ['wf', 'routing'] }); qc.invalidateQueries({ queryKey: ['projects'] }); },
  });
  if (!r) return null;
  const set = (next: WorkflowRouting) => setDraft(next);
  const issueFields = ['issue.type', 'issue.project', 'issue.priority', 'issue.status', 'issue.labels', 'issue.components'] as const;
  return (
    <Card>
      <CardHeader><CardTitle>Which workflow a ticket starts</CardTitle></CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        {r.rules.map((rule, i) => (
          <div key={i} className="flex flex-col gap-2 rounded-md border p-2">
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium">Rule {i + 1}: when</span>
              <span className="flex-1" />
              <button className="rounded p-1 hover:bg-accent" title="Remove rule" onClick={() => set({ ...r, rules: r.rules.filter((_, j) => j !== i) })}><X className="size-3" /></button>
            </div>
            <ConditionEditor fields={issueFields} value={rule.when} onChange={when => set({ ...r, rules: r.rules.map((x, j) => (j === i ? { ...x, when } : x)) })} />
            <label className="flex items-center gap-2 text-xs">start
              <Select value={rule.workflow} onChange={e => set({ ...r, rules: r.rules.map((x, j) => (j === i ? { ...x, workflow: e.target.value } : x)) })}>
                {workflows.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
              </Select>
            </label>
          </div>
        ))}
        <div className="flex flex-wrap items-center gap-2 text-xs">
          Otherwise start
          <Select value={r.default} onChange={e => set({ ...r, default: e.target.value })}>
            {workflows.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
          </Select>
          <Button size="sm" variant="outline" onClick={() => set({ ...r, rules: [...r.rules, { name: '', when: [{ field: 'issue.project', op: 'in', values: ['TC'] }], workflow: r.default }] })}>
            <Plus className="size-3" />Add rule
          </Button>
          <Button size="sm" disabled={!draft || save.isPending} onClick={() => save.mutate()}><Save className="size-3" />Save</Button>
        </div>
        {save.error && <p className="text-sm text-red-600">{(save.error as Error).message}</p>}
        <p className="text-xs text-muted-foreground">Saved to workflows/routing.json. The AI type is not known yet when a run starts; use a Classify node and skip rules inside a workflow for that.</p>
      </CardContent>
    </Card>
  );
}
