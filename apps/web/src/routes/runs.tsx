import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import type { WorkflowRunList } from '@tesserax/contracts';
import { Page, QueryState } from '@/components/page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
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

const TABS = ['waiting', 'running', 'failed', 'done', 'all'] as const;

export function RunsPage() {
  const search = useSearch({ strict: false }) as { status?: string };
  const status = search.status ?? 'waiting';
  const navigate = useNavigate();
  const { scopeParam, selected: scopeSelected } = useProjectScope();
  const q = useQuery({ queryKey: ['wf', 'runs', status, scopeParam], queryFn: () => api<WorkflowRunList>(`/api/workflow-runs?status=${status}&${scopeParam}`), refetchInterval: 4000 });
  const counts = q.data?.counts ?? {};
  const runs = q.data?.runs ?? [];
  return (
    <Page title="Runs" description="Each ticket moves through the workflow's nodes; gates wait for you.">
      <div className="flex flex-wrap gap-1">
        {TABS.map(t => (
          <Button key={t} size="sm" variant={status === t ? 'default' : 'outline'} onClick={() => navigate({ to: '/runs', search: { status: t } as never })}>
            {t === 'all' ? 'All' : RUN_STATUS[t]!.label}{' '}
            <span className="opacity-60">{t === 'all' ? Object.values(counts).reduce((a, b) => a + b, 0) : (counts[t] ?? 0)}</span>
          </Button>
        ))}
      </div>
      <Card>
        <QueryState isLoading={q.isLoading} error={q.error} empty={!q.isLoading && runs.length === 0}
          emptyText="No runs here. Start one with “Start workflow” on the Tasks page (you pick the workflow); new Jira issues start the one the routing rules suggest, and you can switch it on the run until its first step finishes." />
        {runs.length > 0 && (
          <Table>
            <THead><Tr><Th>Ticket</Th><Th>Workflow</Th><Th>Status</Th><Th>Current step</Th><Th>Cost</Th><Th>Updated</Th></Tr></THead>
            <TBody>
              {runs.map(r => (
                <Tr key={r.id}>
                  <Td>
                    <span className="inline-flex items-center gap-1.5">{!scopeSelected && <ProjectDot color={r.task.projectColor} name={r.task.projectSlug} />}<Link to="/runs/$runId" params={{ runId: r.id }} className="font-medium hover:underline">{r.task.key}</Link></span>
                    <div className="max-w-md truncate text-xs text-muted-foreground">{r.task.title}</div>
                  </Td>
                  <Td className="text-xs">{r.workflowId}</Td>
                  <Td><Badge variant={RUN_STATUS[r.status]?.variant ?? 'outline'}>{RUN_STATUS[r.status]?.label ?? r.status}</Badge></Td>
                  <Td className="text-xs">{r.currentNodeLabel ?? '–'}{r.error && <div className="max-w-xs truncate text-red-600" title={r.error}>{r.error}</div>}</Td>
                  <Td className="text-xs">${r.costUsd.toFixed(2)}</Td>
                  <Td className="text-xs whitespace-nowrap text-muted-foreground">{timeAgo(r.updatedAt)}</Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
    </Page>
  );
}
