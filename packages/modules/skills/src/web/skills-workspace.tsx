import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import type { SkillInfo } from '../contracts';
import { useSkillsApi } from './client';
import { PackageList, PackageSkillView, type PackageSkillRef } from './packages';
import { SkillEditor } from './skill-editor';
import { Button, Card, Input, QueryState, cn } from './ui';

const nameOf = (path: string) => path.split('/').at(-2) ?? path;

/** `filter` lets the host hide skills (e.g. those its current scope does not use); `hiddenNote` explains the hidden ones. */
export function SkillsWorkspace({ renderLocalExtras, filter, hiddenNote }: {
  renderLocalExtras?: (s: { name: string; dirty: boolean }) => ReactNode;
  filter?: (skill: SkillInfo) => boolean;
  hiddenNote?: (hidden: number) => ReactNode;
}) {
  const api = useSkillsApi();
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ['skills'], queryFn: () => api<SkillInfo[]>('/skills') });
  const shown = filter ? list.data?.filter(filter) : list.data;
  const hidden = (list.data?.length ?? 0) - (shown?.length ?? 0);
  const [current, setCurrent] = useState<string | null>(null);
  const [pkgSkill, setPkgSkill] = useState<PackageSkillRef | null>(null);
  const [newName, setNewName] = useState('');
  useEffect(() => {
    if (pkgSkill || !shown?.[0]) return;
    const isHidden = hidden > 0 && !shown.some(s => nameOf(s.path) === current) && !!list.data?.some(s => nameOf(s.path) === current);
    if (!current || isHidden) setCurrent(nameOf(shown[0].path));
  }, [shown, hidden, list.data, current, pkgSkill]);
  const create = useMutation({
    mutationFn: () => api('/skills', { method: 'POST', body: JSON.stringify({ name: newName }) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['skills'] }); setCurrent(newName); setNewName(''); },
  });

  return (
    <div className="grid gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
      <Card className="self-start">
        <QueryState isLoading={list.isLoading} error={list.error} />
        <ul className="divide-y">
          {shown?.map(s => (
            <li key={s.path}>
              <button className={cn('w-full px-3 py-2 text-left text-sm hover:bg-accent/60', !pkgSkill && current === nameOf(s.path) && 'bg-accent')} onClick={() => { setPkgSkill(null); setCurrent(nameOf(s.path)); }}>
                <div className="font-medium">{s.name}</div>
                <div className="line-clamp-2 text-xs text-muted-foreground">{s.description}</div>
              </button>
            </li>
          ))}
        </ul>
        {hidden > 0 && hiddenNote && <p className="border-t px-3 py-2 text-xs text-muted-foreground">{hiddenNote(hidden)}</p>}
        <div className="flex gap-1 border-t p-2">
          <Input className="h-7 text-xs" placeholder="new-skill-name" value={newName} onChange={e => setNewName(e.target.value.toLowerCase())} />
          <Button size="sm" disabled={!newName || create.isPending} onClick={() => create.mutate()}><Plus className="size-3" /></Button>
        </div>
        {create.error && <p className="p-2 text-xs text-destructive">{(create.error as Error).message}</p>}
        <PackageList current={pkgSkill} onSelect={setPkgSkill} />
      </Card>
      {pkgSkill ? <PackageSkillView key={`${pkgSkill.id}/${pkgSkill.skill}`} current={pkgSkill} onRemoved={() => setPkgSkill(null)} /> : current ? <SkillEditor key={current} name={current} extras={renderLocalExtras} /> : null}
    </div>
  );
}
