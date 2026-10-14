import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, Package, RefreshCw, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { SKILL_PACKAGE_CATEGORIES, type SkillPackage, type SkillPackageList } from '../contracts';
import { useSkillsApi } from './client';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Input, QueryState, Select, cn } from './ui';

export interface PackageSkillRef { id: string; skill: string }

const usePackages = () => {
  const api = useSkillsApi();
  return useQuery({ queryKey: ['skill-packages'], queryFn: () => api<SkillPackageList>('/skill-packages') });
};

function useRefresh() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ['skill-packages'] });
  };
}

/** Sidebar section: installed packages grouped by category, each with its skills, plus the install form. */
export function PackageList({ current, onSelect }: { current: PackageSkillRef | null; onSelect: (r: PackageSkillRef) => void }) {
  const list = usePackages();
  const groups = new Map<string, SkillPackageList['packages']>();
  for (const p of list.data?.packages ?? []) groups.set(p.category, [...(groups.get(p.category) ?? []), p]);
  return (
    <div className="border-t">
      <div className="flex items-center gap-1.5 px-3 pt-3 pb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase"><Package className="size-3.5" />Packages</div>
      <QueryState isLoading={list.isLoading} error={list.error} />
      {list.data && !list.data.packages.length && <p className="px-3 pb-2 text-xs text-muted-foreground">None installed yet.</p>}
      {[...groups].map(([category, pkgs]) => (
        <div key={category}>
          <div className="px-3 pt-2 text-[11px] text-muted-foreground">{category}</div>
          {pkgs.map(p => (
            <ul key={p.id} className="pb-1">
              <li className="px-3 pt-1 text-xs font-medium">{p.id} {p.version && <span className="font-normal text-muted-foreground">v{p.version}</span>}</li>
              {p.skills.map(s => (
                <li key={s}>
                  <button className={cn('w-full py-1 pr-3 pl-6 text-left text-sm hover:bg-accent/60', current?.id === p.id && current.skill === s && 'bg-accent')} onClick={() => onSelect({ id: p.id, skill: s })}>{s}</button>
                </li>
              ))}
            </ul>
          ))}
        </div>
      ))}
      <InstallForm />
    </div>
  );
}

function InstallForm() {
  const api = useSkillsApi();
  const refresh = useRefresh();
  const [source, setSource] = useState('');
  const [ref, setRef] = useState('');
  const [category, setCategory] = useState('general');
  const install = useMutation({
    mutationFn: () => api<SkillPackage>('/skill-packages', { method: 'POST', body: JSON.stringify({ source: source.trim(), ref: ref.trim() || undefined, category }) }),
    onSuccess: () => { refresh(); setSource(''); setRef(''); },
  });
  return (
    <div className="flex flex-col gap-1 border-t p-2">
      <Input className="h-7 text-xs" placeholder="https://github.com/owner/repo.git" value={source} onChange={e => setSource(e.target.value)} />
      <div className="flex gap-1">
        <Input className="h-7 text-xs" placeholder="branch/tag (optional)" value={ref} onChange={e => setRef(e.target.value)} />
        <CategorySelect value={category} onChange={setCategory} />
      </div>
      <Button size="sm" disabled={!source.trim() || install.isPending} onClick={() => install.mutate()}>
        <Download className="size-3" />{install.isPending ? 'Installing…' : 'Install package'}
      </Button>
      {install.error && <p className="text-xs text-red-600">{(install.error as Error).message}</p>}
    </div>
  );
}

function CategorySelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const options = SKILL_PACKAGE_CATEGORIES.includes(value as never) ? SKILL_PACKAGE_CATEGORIES : [value, ...SKILL_PACKAGE_CATEGORIES];
  return (
    <Select className="h-7 text-xs" value={value} onChange={e => onChange(e.target.value)}>
      {options.map(c => <option key={c}>{c}</option>)}
    </Select>
  );
}

/** Right pane for a package skill: package details and actions, then the skill read-only (updates replace it). */
export function PackageSkillView({ current, onRemoved }: { current: PackageSkillRef; onRemoved: () => void }) {
  const api = useSkillsApi();
  const refresh = useRefresh();
  const list = usePackages();
  const pkg = list.data?.packages.find(p => p.id === current.id);
  const skill = useQuery({
    queryKey: ['skill-packages', current.id, current.skill],
    queryFn: () => api<{ path: string; content: string; hash: string }>(`/skill-packages/${current.id}/skills/${current.skill}`),
  });
  const update = useMutation({
    mutationFn: () => api<SkillPackage & { changed: boolean }>(`/skill-packages/${current.id}/update`, { method: 'POST' }),
    onSuccess: refresh,
  });
  const setCategory = useMutation({
    mutationFn: (category: string) => api(`/skill-packages/${current.id}`, { method: 'PATCH', body: JSON.stringify({ category }) }),
    onSuccess: refresh,
  });
  const remove = useMutation({
    mutationFn: () => api(`/skill-packages/${current.id}${pkg?.usedBy.length ? '?force=1' : ''}`, { method: 'DELETE' }),
    onSuccess: () => { refresh(); onRemoved(); },
  });
  if (!pkg) return <QueryState isLoading={list.isLoading} error={list.error} />;
  const confirmRemove = () => {
    const warn = pkg.usedBy.length ? `\n\nStill used by workflow ${pkg.usedBy.join(', ')}: those nodes will fail until you pick another skill.` : '';
    if (window.confirm(`Remove package ${pkg.id} and its ${pkg.skills.length} skills?${warn}`)) remove.mutate();
  };
  const error = update.error ?? setCategory.error ?? remove.error;
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="flex items-center gap-2"><Package className="size-4" />{pkg.id} {pkg.version && <Badge>v{pkg.version}</Badge>} {pkg.license && <Badge variant="outline">{pkg.license}</Badge>}</CardTitle>
            <div className="flex items-center gap-2">
              <CategorySelect value={pkg.category} onChange={c => setCategory.mutate(c)} />
              <Button size="sm" variant="outline" disabled={update.isPending} onClick={() => update.mutate()}><RefreshCw className={cn('size-3.5', update.isPending && 'animate-spin')} />Update</Button>
              <Button size="sm" variant="outline" disabled={remove.isPending} onClick={confirmRemove}><Trash2 className="size-3.5" />Remove</Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-1 text-xs text-muted-foreground">
          <div>Source <a className="underline" href={pkg.source.replace(/\.git$/, '')} target="_blank" rel="noreferrer">{pkg.source}</a>{pkg.ref ? ` @ ${pkg.ref}` : ''} · commit <code>{pkg.commit.slice(0, 7)}</code> · updated {new Date(pkg.updatedAt).toLocaleString()}</div>
          <div>{pkg.usedBy.length ? <>Used by workflow {pkg.usedBy.join(', ')}</> : 'Not used by any workflow yet. Pick its skills in a node (e.g. AI review) in the workflow editor.'}</div>
          {update.data && <div className="text-foreground">{update.data.changed ? `Updated to ${update.data.commit.slice(0, 7)}.` : 'Already up to date.'}</div>}
          {error && <p className="text-red-600">{(error as Error).message}</p>}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle><code>{skill.data?.path ?? current.skill}</code> {skill.data && <span className="text-xs font-normal text-muted-foreground">version {skill.data.hash.slice(0, 7)} · read-only, Update replaces it</span>}</CardTitle>
        </CardHeader>
        <CardContent>
          <QueryState isLoading={skill.isLoading} error={skill.error} />
          {skill.data && <pre className="max-h-[560px] overflow-auto rounded-md border bg-muted/30 p-3 font-mono text-xs leading-5 whitespace-pre-wrap">{skill.data.content}</pre>}
        </CardContent>
      </Card>
    </div>
  );
}
