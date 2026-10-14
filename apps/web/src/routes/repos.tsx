import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, FolderGit2, GitBranch, Pencil, Plus, Search, Trash2, TriangleAlert, X } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import type { RepoInspection, RepoRegistryView, Repository } from '@tesserax/contracts';
import { Page, QueryState } from '@/components/page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Table, TBody, Td, Th, THead, Tr } from '@/components/ui/table';
import { useRepoRegistry, type WorkplaceView } from '@/components/workplace';
import { api } from '@/lib/api';

const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
const keys = (s: string) => s.split(/[\s,]+/).map(x => x.trim().toUpperCase()).filter(Boolean);

type Editing =
  | { kind: 'repository'; value?: Repository }
  | { kind: 'workplace'; repositoryId: string; value?: WorkplaceView }
  | null;

/** Repositories this project maintains and their workplaces: one local checkout per brand. */
export function ReposPage() {
  const q = useRepoRegistry();
  const [editing, setEditing] = useState<Editing>(null);
  const qc = useQueryClient();
  const remove = useMutation({
    mutationFn: (p: { kind: 'repositories' | 'workplaces'; id: string }) => api(`/api/repos/${p.kind}/${p.id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['repos'] }),
  });
  const v = q.data;
  return (
    <Page
      title="Repos"
      description={<>Repositories this project maintains, and their <b>workplaces</b>: local checkouts, one per brand when the same repo serves several brands. A task runs in the workplace picked on it, else the one registered for its Jira project.{v && <> Saved in <code>{v.file.split('/').slice(-2).join('/')}</code>.</>}</>}
      actions={<Button size="sm" onClick={() => setEditing({ kind: 'repository' })}><Plus className="size-3.5" />Add repository</Button>}
    >
      <QueryState isLoading={q.isLoading} error={q.error} empty={!!v && !v.repositories.length} emptyText="No repository yet. Add one from a local checkout." />
      {remove.error && <p className="text-sm text-red-600">{(remove.error as Error).message}</p>}
      {v?.repositories.map(r => {
        const wps = v.workplaces.filter(w => w.repositoryId === r.id);
        return (
          <Card key={r.id}>
            <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <CardTitle className="flex items-center gap-2"><FolderGit2 className="size-4" />{r.name} <code className="text-xs font-normal text-muted-foreground">{r.id}</code></CardTitle>
                <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  <span>origin <code className="text-foreground">{r.origin ?? '(not set)'}</code></span>
                  <span className="inline-flex items-center gap-1"><GitBranch className="size-3" />base {r.base ?? '(remote default)'}</span>
                  {r.remote && <span>remote {r.remote}</span>}
                  {r.bitbucket && <span>bitbucket {r.bitbucket}</span>}
                </div>
              </div>
              <div className="flex gap-1">
                <Button size="sm" variant="outline" onClick={() => setEditing({ kind: 'workplace', repositoryId: r.id })}><Plus className="size-3" />Workplace</Button>
                <Button size="sm" variant="ghost" title="Edit repository" onClick={() => setEditing({ kind: 'repository', value: r })}><Pencil className="size-3" /></Button>
                <Button size="sm" variant="ghost" title="Delete repository" onClick={() => confirm(`Delete repository ${r.name}?`) && remove.mutate({ kind: 'repositories', id: r.id })}><Trash2 className="size-3" /></Button>
              </div>
            </CardHeader>
            <CardContent>
              {wps.length === 0 ? <p className="text-sm text-muted-foreground">No workplace: add the local checkout this repo is worked on in.</p> : (
                <Table>
                  <THead><Tr><Th>Brand</Th><Th>Workplace (local checkout)</Th><Th>Base</Th><Th>Jira projects</Th><Th>On disk</Th><Th></Th></Tr></THead>
                  <TBody>
                    {wps.map(w => (
                      <Tr key={w.id}>
                        <Td><div className="font-medium">{w.brand}</div><code className="text-xs text-muted-foreground">{w.id}</code></Td>
                        <Td className="max-w-xs"><code className="break-all text-xs">{w.path}</code>{w.notes && <div className="text-xs text-muted-foreground">{w.notes}</div>}</Td>
                        <Td className="text-xs">{w.base ?? <span className="text-muted-foreground">{r.base ?? 'default'}</span>}</Td>
                        <Td>{w.projects.length ? <div className="flex flex-wrap gap-1">{w.projects.map(p => <Badge key={p} variant="outline">{p}</Badge>)}</div> : <span className="text-xs text-muted-foreground">picked per task</span>}</Td>
                        <Td><StatusCell w={w} /></Td>
                        <Td>
                          <div className="flex gap-1">
                            <Button size="sm" variant="ghost" title="Edit workplace" onClick={() => setEditing({ kind: 'workplace', repositoryId: r.id, value: w })}><Pencil className="size-3" /></Button>
                            <Button size="sm" variant="ghost" title="Delete workplace" onClick={() => confirm(`Delete workplace ${w.brand}? The folder is not touched.`) && remove.mutate({ kind: 'workplaces', id: w.id })}><Trash2 className="size-3" /></Button>
                          </div>
                        </Td>
                      </Tr>
                    ))}
                  </TBody>
                </Table>
              )}
            </CardContent>
          </Card>
        );
      })}
      {editing?.kind === 'repository' && <RepositoryForm view={v} value={editing.value} onClose={() => setEditing(null)} />}
      {editing?.kind === 'workplace' && v && <WorkplaceForm view={v} repositoryId={editing.repositoryId} value={editing.value} onClose={() => setEditing(null)} />}
    </Page>
  );
}

function StatusCell({ w }: { w: WorkplaceView }) {
  const s = w.status;
  if (s.error) return <span className="inline-flex items-center gap-1 text-xs text-red-600"><TriangleAlert className="size-3" />{s.error}</span>;
  return (
    <div className="flex flex-col gap-0.5 text-xs">
      {s.originMatches === false
        ? <span className="inline-flex items-center gap-1 text-red-600" title={s.origin ?? ''}><TriangleAlert className="size-3" />other origin: {s.origin}</span>
        : <span className="inline-flex items-center gap-1 text-green-700 dark:text-green-400"><CheckCircle2 className="size-3" />{s.originMatches ? 'origin matches' : 'git checkout'}</span>}
      <span className="inline-flex items-center gap-1 text-muted-foreground"><GitBranch className="size-3" />{s.branch ?? 'detached'}</span>
    </div>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" onMouseDown={onClose}>
      <div className="flex max-h-[92vh] w-full max-w-lg flex-col gap-3 overflow-y-auto rounded-xl border bg-card p-4 shadow-xl" onMouseDown={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="font-semibold">{title}</h3>
          <button className="rounded p-1 hover:bg-accent" onClick={onClose} title="Close"><X className="size-4" /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

const Field = ({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) => (
  <label className="flex flex-col gap-1 text-xs">{label}{children}{hint && <span className="text-muted-foreground">{hint}</span>}</label>
);

function useSave(onClose: () => void) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ path, body }: { path: string; body: unknown }) => api(path, { method: 'PUT', body: JSON.stringify(body) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['repos'] }); onClose(); },
  });
}

/**
 * New repository: start from a local checkout (its origin, name and default branch are read from git), and register
 * that checkout as the first workplace. Editing changes only the repository's own fields.
 */
function RepositoryForm({ view, value, onClose }: { view: RepoRegistryView | undefined; value?: Repository; onClose: () => void }) {
  const [path, setPath] = useState('');
  const [f, setF] = useState({ id: value?.id ?? '', name: value?.name ?? '', origin: value?.origin ?? '', base: value?.base ?? '', remote: value?.remote ?? '', bitbucket: value?.bitbucket ?? '' });
  const [brand, setBrand] = useState('');
  const [projects, setProjects] = useState('');
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF(prev => ({ ...prev, [k]: e.target.value }));
  const inspect = useMutation({
    mutationFn: () => api<RepoInspection>('/api/repos/inspect', { method: 'POST', body: JSON.stringify({ path }) }),
    onSuccess: r => setF(prev => ({
      ...prev, name: prev.name || r.suggestedName, id: prev.id || slugify(r.suggestedName), origin: r.origin ?? prev.origin, base: prev.base || r.defaultBranch || '',
    })),
  });
  const save = useSave(onClose);
  const existing = inspect.data?.repositoryId ? view?.repositories.find(r => r.id === inspect.data!.repositoryId) : undefined;
  const submit = async () => {
    const repo = { name: f.name.trim(), origin: f.origin.trim() || null, ...(f.base.trim() ? { base: f.base.trim() } : {}), ...(f.remote.trim() ? { remote: f.remote.trim() } : {}), ...(f.bitbucket.trim() ? { bitbucket: f.bitbucket.trim() } : {}) };
    const id = existing?.id ?? f.id;
    if (!existing) await api(`/api/repos/repositories/${id}`, { method: 'PUT', body: JSON.stringify(repo) });
    if (!value && inspect.data) {
      const b = brand.trim() || f.name.trim();
      return save.mutateAsync({ path: `/api/repos/workplaces/${slugify(`${id}-${b}`)}`, body: { repositoryId: id, brand: b, path: inspect.data.path, projects: keys(projects) } });
    }
    return save.mutateAsync({ path: `/api/repos/repositories/${id}`, body: repo });
  };
  const run = useMutation({ mutationFn: submit });
  return (
    <Modal title={value ? `Edit repository ${value.name}` : 'Add repository'} onClose={onClose}>
      {!value && (
        <Field label="Local checkout" hint="Absolute path inside your home folder; origin, name and default branch are read from git.">
          <div className="flex gap-2">
            <Input className="flex-1" autoFocus value={path} onChange={e => setPath(e.target.value)} placeholder="/Users/you/Workplace/shop-core" onKeyDown={e => e.key === 'Enter' && path && inspect.mutate()} />
            <Button size="sm" variant="outline" disabled={!path.trim() || inspect.isPending} onClick={() => inspect.mutate()}><Search className="size-3.5" />Read</Button>
          </div>
          {inspect.error && <span className="text-red-600">{(inspect.error as Error).message}</span>}
          {inspect.data && <span className="text-muted-foreground">branch {inspect.data.branch ?? 'detached'} · origin {inspect.data.origin ?? '(none)'}</span>}
        </Field>
      )}
      {existing && <p className="rounded-md bg-sky-500/10 p-2 text-xs">This checkout belongs to the registered repository <b>{existing.name}</b> (same origin). It is added as another workplace of it.</p>}
      {(value || (inspect.data && !existing)) && (
        <div className="grid gap-2 sm:grid-cols-2">
          <Field label="Name"><Input value={f.name} onChange={set('name')} /></Field>
          <Field label="Id" hint={value ? 'Cannot be changed.' : 'lowercase, used in links'}><Input value={f.id} disabled={!!value} onChange={e => setF(prev => ({ ...prev, id: slugify(e.target.value) }))} /></Field>
          <div className="sm:col-span-2"><Field label="Origin (git remote URL)"><Input value={f.origin} onChange={set('origin')} placeholder="git@bitbucket.org:team/repo.git" /></Field></div>
          <Field label="Base branch" hint="Where new work starts; empty = the remote's default."><Input value={f.base} onChange={set('base')} placeholder="develop" /></Field>
          <Field label="Remote" hint="Default origin."><Input value={f.remote} onChange={set('remote')} placeholder="origin" /></Field>
          <div className="sm:col-span-2"><Field label="Bitbucket workspace/repo" hint="Only when it cannot be read from the origin URL."><Input value={f.bitbucket} onChange={set('bitbucket')} placeholder="team/repo" /></Field></div>
        </div>
      )}
      {!value && inspect.data && (
        <div className="grid gap-2 rounded-md border p-2 sm:grid-cols-2">
          <div className="text-xs font-medium sm:col-span-2">First workplace: this checkout</div>
          <Field label="Brand"><Input value={brand} onChange={e => setBrand(e.target.value)} placeholder="ShopBrand" /></Field>
          <Field label="Jira projects" hint="Tasks of these projects default here."><Input value={projects} onChange={e => setProjects(e.target.value)} placeholder="COL" /></Field>
        </div>
      )}
      {(run.error || save.error) && <p className="text-sm text-red-600">{((run.error ?? save.error) as Error).message}</p>}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button disabled={run.isPending || (!value && !inspect.data) || (!existing && (!f.name.trim() || !f.id))} onClick={() => run.mutate()}>{value ? 'Save' : existing ? 'Add workplace' : 'Add repository'}</Button>
      </div>
    </Modal>
  );
}

function WorkplaceForm({ view, repositoryId, value, onClose }: { view: RepoRegistryView; repositoryId: string; value?: WorkplaceView; onClose: () => void }) {
  const repo = view.repositories.find(r => r.id === repositoryId);
  const [f, setF] = useState({ brand: value?.brand ?? '', path: value?.path ?? '', base: value?.base ?? '', projects: value?.projects.join(', ') ?? '', notes: value?.notes ?? '' });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF(prev => ({ ...prev, [k]: e.target.value }));
  const inspect = useMutation({ mutationFn: () => api<RepoInspection>('/api/repos/inspect', { method: 'POST', body: JSON.stringify({ path: f.path }) }) });
  const save = useSave(onClose);
  const id = value?.id ?? slugify(`${repositoryId}-${f.brand}`);
  const taken = keys(f.projects).flatMap(p => view.workplaces.filter(w => w.id !== id && w.projects.includes(p)).map(w => `${p} → ${w.brand}`));
  const otherOrigin = inspect.data && repo?.origin && inspect.data.repositoryId !== repositoryId;
  return (
    <Modal title={value ? `Edit workplace ${value.brand}` : `New workplace of ${repo?.name ?? repositoryId}`} onClose={onClose}>
      <div className="grid gap-2 sm:grid-cols-2">
        <Field label="Brand"><Input autoFocus value={f.brand} onChange={set('brand')} placeholder="ShopBrand" /></Field>
        <Field label="Base branch" hint={`Empty = the repository's (${repo?.base ?? 'remote default'}).`}><Input value={f.base} onChange={set('base')} /></Field>
        <div className="sm:col-span-2">
          <Field label="Local checkout (absolute path)" hint="A clone or worktree of this repository, with this brand's .env and config.">
            <div className="flex gap-2">
              <Input className="flex-1" value={f.path} onChange={set('path')} onBlur={() => f.path.trim() && inspect.mutate()} placeholder="/Users/you/Workplace/shop-core-brand2" />
              <Button size="sm" variant="outline" disabled={!f.path.trim() || inspect.isPending} onClick={() => inspect.mutate()}><Search className="size-3.5" />Check</Button>
            </div>
            {inspect.error && <span className="text-red-600">{(inspect.error as Error).message}</span>}
            {inspect.data && <span className={otherOrigin ? 'text-red-600' : 'text-muted-foreground'}>{otherOrigin ? `Its origin is ${inspect.data.origin}, not this repository's.` : `OK · branch ${inspect.data.branch ?? 'detached'} · origin ${inspect.data.origin ?? '(none)'}`}</span>}
          </Field>
        </div>
        <div className="sm:col-span-2"><Field label="Jira projects (comma separated)" hint="Tasks of these projects run here unless a task picks another workplace."><Input value={f.projects} onChange={set('projects')} placeholder="COL" /></Field></div>
        {taken.length > 0 && <p className="text-xs text-amber-600 sm:col-span-2">Already mapped elsewhere ({taken.join(', ')}): the first registered workplace wins for those projects.</p>}
        <div className="sm:col-span-2"><Field label="Notes"><Input value={f.notes} onChange={set('notes')} /></Field></div>
      </div>
      {save.error && <p className="text-sm text-red-600">{(save.error as Error).message}</p>}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button
          disabled={!f.brand.trim() || !f.path.trim() || save.isPending}
          onClick={() => save.mutate({
            path: `/api/repos/workplaces/${id}`,
            body: { repositoryId, brand: f.brand.trim(), path: f.path.trim(), projects: keys(f.projects), ...(f.base.trim() ? { base: f.base.trim() } : {}), ...(f.notes.trim() ? { notes: f.notes.trim() } : {}) },
          })}
        >
          {value ? 'Save' : 'Add workplace'}
        </Button>
      </div>
    </Modal>
  );
}
