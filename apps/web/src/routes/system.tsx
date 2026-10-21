import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, X } from 'lucide-react';
import { useState } from 'react';
import type { FeedbackStats, GithubSourceItem, SystemInfo } from '@tesserax/contracts';
import { Page, QueryState } from '@/components/page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/api';

export function SystemPage() {
  const q = useQuery({ queryKey: ['system'], queryFn: () => api<SystemInfo>('/api/system'), refetchInterval: 10_000 });
  const fb = useQuery({ queryKey: ['pipeline', 'feedback'], queryFn: () => api<FeedbackStats>('/api/pipeline/feedback') });
  const gh = useQuery({ queryKey: ['tasks', 'sources', 'github'], queryFn: () => api<GithubSourceItem[]>('/api/tasks/sources/github') });
  const qc = useQueryClient();
  const [showAdd, setShowAdd] = useState(false);
  const [repo, setRepo] = useState('');
  const [labels, setLabels] = useState('tesserax');
  const [assignee, setAssignee] = useState('');
  const [projectSlug, setProjectSlug] = useState('');

  const addSource = useMutation({
    mutationFn: () =>
      api('/api/tasks/sources/github', {
        method: 'POST',
        body: JSON.stringify({
          repo: repo.trim(),
          labels: labels.split(',').map(s => s.trim()).filter(Boolean),
          assignee: assignee.trim() || undefined,
          projectSlug: projectSlug.trim() || undefined,
        }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tasks', 'sources', 'github'] });
      setShowAdd(false);
      setRepo('');
      setLabels('tesserax');
      setAssignee('');
      setProjectSlug('');
    },
  });

  const removeSource = useMutation({
    mutationFn: (id: string) => api(`/api/tasks/sources/github/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tasks', 'sources', 'github'] }),
  });

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
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>Nguồn task GitHub</CardTitle>
              <Button size="sm" onClick={() => setShowAdd(true)}>
                <Plus className="size-3.5" />
                Thêm nguồn GitHub
              </Button>
            </CardHeader>
            <CardContent className="text-sm">
              {gh.isLoading && <p className="text-xs text-muted-foreground">Đang tải...</p>}
              {gh.data && gh.data.length === 0 && (
                <p className="text-muted-foreground text-xs">Chưa có nguồn GitHub nào.</p>
              )}
              {gh.data && gh.data.length > 0 && (
                <ul className="flex flex-col gap-2">
                  {gh.data.map(src => (
                    <li key={src.id} className="flex items-center justify-between gap-2 rounded-md border p-2">
                      <div className="flex flex-col gap-0.5">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold">{src.name}</span>
                          {src.project_slug && <Badge variant="outline">{src.project_slug}</Badge>}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {src.last_synced_at ? `Đồng bộ: ${new Date(src.last_synced_at).toLocaleTimeString()}` : 'Chưa đồng bộ'}
                        </div>
                        {src.last_error && <span className="text-xs text-red-500">{src.last_error}</span>}
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={removeSource.isPending}
                        onClick={() => removeSource.mutate(src.id)}
                        title="Xoá nguồn"
                      >
                        <Trash2 className="size-3.5 text-muted-foreground hover:text-red-500" />
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
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
      {showAdd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" onMouseDown={() => setShowAdd(false)}>
          <div className="flex w-full max-w-md flex-col gap-3 rounded-lg border bg-background p-4 shadow-lg" onMouseDown={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-sm">Thêm nguồn GitHub</h3>
              <button className="rounded p-1 hover:bg-accent" onClick={() => setShowAdd(false)} title="Đóng"><X className="size-4" /></button>
            </div>
            <div className="flex flex-col gap-2 text-xs">
              <label className="flex flex-col gap-1">
                Repository (owner/name)
                <Input autoFocus value={repo} onChange={e => setRepo(e.target.value)} placeholder="owner/repo" />
              </label>
              <label className="flex flex-col gap-1">
                Labels (phân cách bằng dấu phẩy)
                <Input value={labels} onChange={e => setLabels(e.target.value)} placeholder="tesserax" />
              </label>
              <label className="flex flex-col gap-1">
                Assignee (tuỳ chọn)
                <Input value={assignee} onChange={e => setAssignee(e.target.value)} placeholder="github-username" />
              </label>
              <label className="flex flex-col gap-1">
                Project slug (tuỳ chọn)
                <Input value={projectSlug} onChange={e => setProjectSlug(e.target.value)} placeholder="company" />
              </label>
            </div>
            {addSource.error && <p className="text-xs text-red-500">{(addSource.error as Error).message}</p>}
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="ghost" size="sm" onClick={() => setShowAdd(false)}>Huỷ</Button>
              <Button size="sm" disabled={!repo.trim() || addSource.isPending} onClick={() => addSource.mutate()}>
                Thêm nguồn
              </Button>
            </div>
          </div>
        </div>
      )}
    </Page>
  );
}
