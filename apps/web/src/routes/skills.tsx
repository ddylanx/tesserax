import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Play, Plus, Save } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { TaskList } from '@ot/contracts';
import { Page, QueryState } from '@/components/page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/input';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';

interface SkillInfo { path: string; name: string; description: string; hash: string }
const nameOf = (path: string) => path.split('/').at(-2) ?? path;

export function SkillsPage() {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ['skills'], queryFn: () => api<SkillInfo[]>('/api/skills') });
  const [current, setCurrent] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  useEffect(() => {
    if (!current && list.data?.[0]) setCurrent(nameOf(list.data[0].path));
  }, [list.data, current]);
  const create = useMutation({
    mutationFn: () => api('/api/skills', { method: 'POST', body: JSON.stringify({ name: newName }) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['skills'] }); setCurrent(newName); setNewName(''); },
  });

  return (
    <Page title="Skills" description="skills/<name>/SKILL.md (Claude Code skill format). Workflow nodes reference them; each run records the version used.">
      <div className="grid gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
        <Card className="self-start">
          <QueryState isLoading={list.isLoading} error={list.error} />
          <ul className="divide-y">
            {list.data?.map(s => (
              <li key={s.path}>
                <button className={cn('w-full px-3 py-2 text-left text-sm hover:bg-accent/60', current === nameOf(s.path) && 'bg-accent')} onClick={() => setCurrent(nameOf(s.path))}>
                  <div className="font-medium">{s.name}</div>
                  <div className="line-clamp-2 text-xs text-muted-foreground">{s.description}</div>
                </button>
              </li>
            ))}
          </ul>
          <div className="flex gap-1 border-t p-2">
            <Input className="h-7 text-xs" placeholder="new-skill-name" value={newName} onChange={e => setNewName(e.target.value.toLowerCase())} />
            <Button size="sm" disabled={!newName || create.isPending} onClick={() => create.mutate()}><Plus className="size-3" /></Button>
          </div>
          {create.error && <p className="p-2 text-xs text-red-600">{(create.error as Error).message}</p>}
        </Card>
        {current ? <SkillEditor key={current} name={current} /> : null}
      </div>
    </Page>
  );
}

function SkillEditor({ name }: { name: string }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['skill', name], queryFn: () => api<{ path: string; content: string; hash: string }>(`/api/skills/${name}`) });
  const [text, setText] = useState<string | null>(null);
  useEffect(() => { if (q.data && text === null) setText(q.data.content); }, [q.data, text]);
  const save = useMutation({
    mutationFn: () => api<{ hash: string }>(`/api/skills/${name}`, { method: 'PUT', body: JSON.stringify({ content: text }) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['skill', name] }); qc.invalidateQueries({ queryKey: ['skills'] }); },
  });
  if (!q.data || text === null) return <QueryState isLoading={q.isLoading} error={q.error} />;
  const dirty = text !== q.data.content;
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle><code>{q.data.path}</code> <span className="text-xs font-normal text-muted-foreground">version {q.data.hash.slice(0, 7)}</span></CardTitle>
            <div className="flex items-center gap-2">
              {dirty && <Badge variant="amber">unsaved</Badge>}
              <Button size="sm" disabled={!dirty || save.isPending} onClick={() => save.mutate()}><Save className="size-3.5" />Save</Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <textarea className="min-h-[420px] w-full rounded-md border bg-background p-3 font-mono text-xs leading-5" value={text} onChange={e => setText(e.target.value)} spellCheck={false} />
          {save.error && <p className="mt-2 text-sm text-red-600">{(save.error as Error).message}</p>}
        </CardContent>
      </Card>
      <TrySkill name={name} dirty={dirty} />
    </div>
  );
}

function TrySkill({ name, dirty }: { name: string; dirty: boolean }) {
  const tasks = useQuery({ queryKey: ['tasks', 'all-open'], queryFn: () => api<TaskList>('/api/tasks') });
  const [taskId, setTaskId] = useState('');
  const [prompt, setPrompt] = useState('Apply the skill to this ticket.\n\n{{issue}}');
  const run = useMutation({
    mutationFn: () => api<{ output: string; costUsd: number | null; seconds: number; cwd: string }>(`/api/skills/${name}/try`, { method: 'POST', body: JSON.stringify({ taskId, prompt }) }),
  });
  return (
    <Card>
      <CardHeader><CardTitle>Try this skill on a ticket (read-only)</CardTitle></CardHeader>
      <CardContent className="flex flex-col gap-2 text-sm">
        <Select value={taskId} onChange={e => setTaskId(e.target.value)}>
          <option value="">Choose a ticket…</option>
          {tasks.data?.tasks.map(t => <option key={t.id} value={t.id}>{t.key} · {t.title.slice(0, 80)}</option>)}
        </Select>
        <textarea className="min-h-20 rounded-md border bg-background p-2 font-mono text-xs" value={prompt} onChange={e => setPrompt(e.target.value)} />
        <div className="flex items-center gap-2">
          <Button size="sm" disabled={!taskId || run.isPending} onClick={() => run.mutate()}><Play className="size-3.5" />{run.isPending ? 'Running… (can take a minute)' : 'Run'}</Button>
          {dirty && <span className="text-xs text-amber-600">Save first: the saved version is what runs.</span>}
        </div>
        {run.error && <p className="text-sm text-red-600">{(run.error as Error).message}</p>}
        {run.data && (
          <>
            <p className="text-xs text-muted-foreground">{run.data.seconds}s · {run.data.costUsd != null ? `$${run.data.costUsd.toFixed(3)}` : ''} · ran in {run.data.cwd}</p>
            <pre className="max-h-[480px] overflow-auto rounded-md bg-muted/50 p-2 text-xs whitespace-pre-wrap">{run.data.output}</pre>
          </>
        )}
      </CardContent>
    </Card>
  );
}
