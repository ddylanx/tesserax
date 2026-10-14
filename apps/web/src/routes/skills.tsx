import { useMutation, useQuery } from '@tanstack/react-query';
import { Play } from 'lucide-react';
import { useState } from 'react';
import type { TaskList } from '@tesserax/contracts';
import { SkillsClientProvider, SkillsWorkspace, type SkillsClient } from '@tesserax/mod-skills/web';
import { Page } from '@/components/page';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select } from '@/components/ui/input';
import { api } from '@/lib/api';

const client: SkillsClient = { fetchJson: (path, init) => api(`/api${path}`, init) };

export function SkillsPage() {
  return (
    <Page title="Skills" description="skills/<name>/SKILL.md (Claude Code skill format), plus packages installed from git into skills/_packages/. Workflow nodes reference them; each run records the version used.">
      <SkillsClientProvider client={client}>
        <SkillsWorkspace renderLocalExtras={({ name, dirty }) => <TrySkill name={name} dirty={dirty} />} />
      </SkillsClientProvider>
    </Page>
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
