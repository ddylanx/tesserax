import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import type { SkillInfo } from '../contracts';
import { useSkillsApi } from './client';
import { PackageList, PackageSkillView, type PackageSkillRef } from './packages';
import { SkillEditor } from './skill-editor';
import { Button, Card, Input, QueryState, cn } from './ui';

const nameOf = (path: string) => path.split('/').at(-2) ?? path;

export function SkillsWorkspace({ renderLocalExtras }: { renderLocalExtras?: (s: { name: string; dirty: boolean }) => ReactNode }) {
  const api = useSkillsApi();
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ['skills'], queryFn: () => api<SkillInfo[]>('/skills') });
  const [current, setCurrent] = useState<string | null>(null);
  const [pkgSkill, setPkgSkill] = useState<PackageSkillRef | null>(null);
  const [newName, setNewName] = useState('');
  useEffect(() => {
    if (!current && !pkgSkill && list.data?.[0]) setCurrent(nameOf(list.data[0].path));
  }, [list.data, current, pkgSkill]);
  const create = useMutation({
    mutationFn: () => api('/skills', { method: 'POST', body: JSON.stringify({ name: newName }) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['skills'] }); setCurrent(newName); setNewName(''); },
  });

  return (
    <div className="grid gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
      <Card className="self-start">
        <QueryState isLoading={list.isLoading} error={list.error} />
        <ul className="divide-y">
          {list.data?.map(s => (
            <li key={s.path}>
              <button className={cn('w-full px-3 py-2 text-left text-sm hover:bg-accent/60', !pkgSkill && current === nameOf(s.path) && 'bg-accent')} onClick={() => { setPkgSkill(null); setCurrent(nameOf(s.path)); }}>
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
        <PackageList current={pkgSkill} onSelect={setPkgSkill} />
      </Card>
      {pkgSkill ? <PackageSkillView key={`${pkgSkill.id}/${pkgSkill.skill}`} current={pkgSkill} onRemoved={() => setPkgSkill(null)} /> : current ? <SkillEditor key={current} name={current} extras={renderLocalExtras} /> : null}
    </div>
  );
}
