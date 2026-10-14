import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Save } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import type { SkillContent } from '../contracts';
import { useSkillsApi } from './client';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, QueryState } from './ui';

export function SkillEditor({ name, extras }: { name: string; extras?: (s: { name: string; dirty: boolean }) => ReactNode }) {
  const api = useSkillsApi();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['skill', name], queryFn: () => api<SkillContent>(`/skills/${name}`) });
  const [text, setText] = useState<string | null>(null);
  useEffect(() => { if (q.data && text === null) setText(q.data.content); }, [q.data, text]);
  const save = useMutation({
    mutationFn: () => api<{ hash: string }>(`/skills/${name}`, { method: 'PUT', body: JSON.stringify({ content: text }) }),
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
      {extras?.({ name, dirty })}
    </div>
  );
}
