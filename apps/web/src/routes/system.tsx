import { useQuery } from '@tanstack/react-query';
import type { FeedbackStats, SystemInfo } from '@ot/contracts';
import { Page, QueryState } from '@/components/page';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { api } from '@/lib/api';

export function SystemPage() {
  const q = useQuery({ queryKey: ['system'], queryFn: () => api<SystemInfo>('/api/system'), refetchInterval: 10_000 });
  const fb = useQuery({ queryKey: ['pipeline', 'feedback'], queryFn: () => api<FeedbackStats>('/api/pipeline/feedback') });
  const s = q.data;
  return (
    <Page title="System" description="Health of the local backoffice, its schedules and integrations.">
      <QueryState isLoading={q.isLoading} error={q.error} />
      {s && (
        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader><CardTitle>Health</CardTitle></CardHeader>
            <CardContent className="flex flex-wrap gap-2 text-sm">
              <Badge variant={s.health.status === 'ok' ? 'green' : 'red'}>overall: {s.health.status}</Badge>
              <Badge variant={s.health.db === 'ok' ? 'green' : 'red'}>postgres: {s.health.db}</Badge>
              <Badge variant={s.health.queue === 'ok' ? 'green' : 'red'}>pg-boss: {s.health.queue}</Badge>
              <Badge variant="outline">uptime {Math.round(s.health.uptimeSeconds / 60)} min</Badge>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Workspaces</CardTitle></CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              {s.workspaces.map(w => <Badge key={w.id}>{w.name} <span className="text-muted-foreground">({w.kind})</span></Badge>)}
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Schedules (pg-boss)</CardTitle></CardHeader>
            <CardContent className="text-sm">
              {s.schedules.length === 0 && <p className="text-muted-foreground">No schedules registered.</p>}
              <ul className="flex flex-col gap-1">
                {s.schedules.map(x => (
                  <li key={x.name} className="flex items-center justify-between gap-2">
                    <code className="text-xs">{x.name}</code>
                    <span className="flex gap-1">
                      <Badge variant="outline">{x.cron}{x.jitterSeconds ? ` ±${x.jitterSeconds}s` : ''}</Badge>
                      <Badge variant={x.enabled ? 'green' : 'default'}>{x.enabled ? 'on' : 'off'}</Badge>
                    </span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Integrations</CardTitle></CardHeader>
            <CardContent className="text-sm">
              <ul className="flex flex-col gap-1">
                {s.integrations.map(i => (
                  <li key={i.name} className="flex items-center justify-between gap-2">
                    <span>{i.name}{!i.configured && i.note && <span className="block text-xs text-muted-foreground">set {i.note} in .env</span>}</span>
                    <Badge variant={i.configured ? 'green' : 'default'}>{i.configured ? 'configured' : 'not set'}</Badge>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
          {fb.data && (
            <Card className="md:col-span-2">
              <CardHeader><CardTitle>Pipeline feedback (your verifications)</CardTitle></CardHeader>
              <CardContent className="flex flex-col gap-2 text-sm">
                <div className="flex flex-wrap gap-2">
                  <Badge>{fb.data.total} verified runs</Badge>
                  <Badge variant="green">{fb.data.verifiedTrue} correct</Badge>
                  <Badge variant="outline">classification kept as suggested: {fb.data.classificationAccepted}/{fb.data.total}</Badge>
                </div>
                {fb.data.byPlaybook.length > 0 && (
                  <ul className="text-xs">
                    {fb.data.byPlaybook.map(p => <li key={p.playbookId ?? '-'}>{p.playbookId ?? '(none)'}: {p.verifiedTrue}/{p.total} correct</li>)}
                  </ul>
                )}
                {fb.data.byEngine.length > 0 && (
                  <ul className="text-xs text-muted-foreground">
                    {fb.data.byEngine.map(e => <li key={e.engine ?? '-'}>classifier {e.engine ?? '?'}: suggestion kept {e.accepted}/{e.total}</li>)}
                  </ul>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </Page>
  );
}
