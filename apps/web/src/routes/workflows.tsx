import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { Page, QueryState } from '@/components/page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/api';

export function WorkflowsPage() {
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
    </Page>
  );
}
