import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { Ban, Check, Lightbulb, Lock, Pencil, Plus, Table2, Trash2, Users, X } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import {
  CONTEXT_LIMITS, IMPROVEMENT_STATUSES, contextState, packAllows,
  type ContextOverview, type ContextPack, type ContextState, type Improvement, type ImprovementStatus, type RoleContext, type RoleContextText, type TeamList,
} from '@tesserax/contracts';
import { Markdown } from '@/components/markdown';
import { Page, QueryState } from '@/components/page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { FilterChip } from '@/components/ui/filter-chip';
import { Input } from '@/components/ui/input';
import { Count, Tag } from '@/components/ui/status-pill';
import { Table, TBody, Td, Th, THead, Tr } from '@/components/ui/table';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';

export type ContextView = 'matrix' | 'improve';
const send = (method: string, body?: unknown) => ({ method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
const n = (v: number) => v.toLocaleString('en-US');
const k = (v: number) => (v < 1000 ? String(v) : `${(v / 1000).toFixed(v < 10_000 ? 1 : 0)}k`);
const fail = (e: unknown) => alert((e as Error).message);

/** The switches of a role after one pack is turned on or off (pinned packs need no switch; stale ones are dropped). */
const toggled = (role: RoleContext, slug: string, on: boolean) => {
  const current = role.using.filter(s => !role.pinned.includes(s));
  return on ? [...current, slug] : current.filter(s => s !== slug);
};

export function ContextPage() {
  const qc = useQueryClient();
  const { view, role: roleKey } = useSearch({ from: '/context' });
  const navigate = useNavigate({ from: '/context' });
  const overview = useQuery({ queryKey: ['context'], queryFn: () => api<ContextOverview>('/api/team/context') });
  const team = useQuery({ queryKey: ['team', ''], queryFn: () => api<TeamList>('/api/team') });
  const improvements = useQuery({ queryKey: ['context', 'improvements'], queryFn: () => api<{ improvements: Improvement[] }>('/api/team/improvements') });
  const [editPack, setEditPack] = useState<ContextPack | 'new' | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ['context'] });
  const setPacks = useMutation({
    mutationFn: (v: { roleId: string; packs: string[] }) => api(`/api/team/context/roles/${v.roleId}`, send('PUT', { packs: v.packs })),
    onSuccess: refresh, onError: fail,
  });
  const toggle = (role: RoleContext, slug: string, on: boolean) => setPacks.mutate({ roleId: role.roleId, packs: toggled(role, slug, on) });

  // roles in the order of the Team page: by department, then by position
  const order = new Map((team.data?.departments ?? []).map((d, i) => [d.id, i]));
  const data = overview.data && { ...overview.data, roles: [...overview.data.roles].sort((a, b) => (order.get(a.departmentId) ?? 99) - (order.get(b.departmentId) ?? 99)) };
  const all = improvements.data?.improvements ?? [];
  const waiting = all.filter(i => i.status === 'proposed').length;
  const tab = (v: ContextView | undefined, label: string, icon: ReactNode, count?: number) => (
    <Button size="sm" variant={view === v ? 'default' : 'ghost'} onClick={() => navigate({ search: v ? { view: v } : {} })}>{icon}{label}<Count n={count} tone="warning" className={view === v ? 'bg-white/25 text-white' : undefined} /></Button>
  );
  return (
    <Page
      title="Context"
      description={<>What each role reads besides its own prompt: context packs (switched per role, inside each pack's audience) and the lessons you approved. Roles propose how to do their job better at the end of a step; nothing changes until you approve it.</>}
      actions={
        <div className="flex gap-2">
          <div className="flex rounded-md border p-0.5">
            {tab(undefined, 'By role', <Users className="size-3.5" />)}
            {tab('matrix', 'Matrix', <Table2 className="size-3.5" />)}
            {tab('improve', 'Proposals', <Lightbulb className="size-3.5" />, waiting)}
          </div>
          <Button onClick={() => setEditPack('new')}><Plus className="size-3.5" />Pack</Button>
        </div>
      }
    >
      <QueryState isLoading={overview.isLoading} error={overview.error} />
      {data && view === undefined && (
        <ByRole data={data} team={team.data} improvements={all} selected={roleKey} busy={setPacks.isPending}
          onSelect={key => navigate({ search: { role: key } })} onToggle={toggle} onEditPack={setEditPack} onChanged={refresh} />
      )}
      {data && view === 'matrix' && <Matrix data={data} busy={setPacks.isPending} onToggle={toggle} onEditPack={setEditPack} />}
      {data && view === 'improve' && <Proposals items={all} packs={data.packs} onChanged={refresh} />}
      {editPack && data && <PackDialog pack={editPack === 'new' ? undefined : editPack} roles={data.roles} onClose={() => setEditPack(null)} onSaved={refresh} />}
    </Page>
  );
}

/** Prompt + context against the limit; red when over. */
function Meter({ role, wide }: { role: RoleContext; wide?: boolean }) {
  const { prompt, context, limit } = role.chars;
  const pct = (v: number) => `${Math.min(100, (v / limit) * 100)}%`;
  return (
    <div className={cn('flex flex-col gap-1', wide ? 'w-full' : 'w-24 shrink-0')} title={`prompt ${n(prompt)} + context ${n(context)} of ${n(limit)} characters`}>
      <div className="flex h-1.5 overflow-hidden rounded-full bg-muted">
        <div className="bg-muted-foreground/50" style={{ width: pct(prompt) }} />
        <div className={role.overLimit ? 'bg-destructive' : 'bg-primary'} style={{ width: pct(context) }} />
      </div>
      <span className={cn('font-mono text-[11px] tabular-nums', role.overLimit ? 'text-destructive' : 'text-muted-foreground')}>
        {wide ? <>{n(prompt + context)} / {n(limit)} characters · prompt {n(prompt)} · context {n(context)}</> : <>{k(prompt + context)} / {k(limit)}</>}
      </span>
    </div>
  );
}

function ByRole({ data, team, improvements, selected, busy, onSelect, onToggle, onEditPack, onChanged }: {
  data: ContextOverview; team?: TeamList; improvements: Improvement[]; selected?: string; busy: boolean;
  onSelect: (key: string) => void; onToggle: (role: RoleContext, slug: string, on: boolean) => void; onEditPack: (p: ContextPack) => void; onChanged: () => void;
}) {
  const role = data.roles.find(r => r.key === selected) ?? data.roles[0];
  if (!role) return <QueryState isLoading={false} error={null} empty emptyText="No roles yet. Create them on the Team page." />;
  const departments = team?.departments ?? [];
  const groups = departments.length ? departments.map(d => ({ name: d.name, roles: data.roles.filter(r => r.departmentId === d.id) })).filter(g => g.roles.length) : [{ name: 'Roles', roles: data.roles }];
  const pack = (slug: string) => data.packs.find(p => p.slug === slug);
  const section = (title: string, hint: string, slugs: string[], state: 'using' | 'available' | 'blocked') => (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline gap-2">
        <h3 className="text-sm font-semibold">{title}</h3><Count n={slugs.length} /><span className="text-xs text-muted-foreground">{hint}</span>
      </div>
      {!slugs.length && <p className="text-xs text-muted-foreground">None.</p>}
      {slugs.map(slug => {
        const p = pack(slug);
        if (!p) return null;
        const pinned = role.pinned.includes(slug);
        return (
          <div key={slug} className={cn('flex items-start gap-3 rounded-md border p-2', state === 'blocked' && 'bg-muted/40 text-muted-foreground')}>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-sm font-medium">{p.name}</span><Tag className="font-mono">{slug}</Tag>
                {pinned && <Badge variant="blue"><Lock className="size-3" />always on</Badge>}
                <span className="font-mono text-[11px] text-muted-foreground">{n(p.chars)} chars</span>
              </div>
              {p.description && <p className="text-xs text-muted-foreground">{p.description}</p>}
              {state === 'blocked' && <p className="text-xs">Audience: {p.audience?.join(', ') || 'nobody'}. Add {role.key} to the pack's audience to allow it.</p>}
            </div>
            <div className="flex shrink-0 gap-1">
              {state === 'using' && !pinned && <Button size="sm" variant="secondary" disabled={busy} onClick={() => onToggle(role, slug, false)}>Switch off</Button>}
              {state === 'available' && <Button size="sm" disabled={busy} onClick={() => onToggle(role, slug, true)}>Switch on</Button>}
              <Button size="icon-sm" variant="ghost" title="Open the pack" onClick={() => onEditPack(p)}><Pencil className="size-3.5" /></Button>
            </div>
          </div>
        );
      })}
    </div>
  );
  const own = improvements.filter(i => i.roleId === role.roleId);
  return (
    <div className="grid gap-4 md:grid-cols-[280px_1fr]">
      <div className="flex flex-col gap-3">
        {groups.map(g => (
          <div key={g.name} className="flex flex-col gap-1">
            <span className="text-xs font-medium text-muted-foreground">{g.name}</span>
            {g.roles.map(r => (
              <button key={r.key} onClick={() => onSelect(r.key)} className={cn('flex items-center justify-between gap-2 rounded-md border p-2 text-left hover:bg-accent', r.key === role.key && 'border-primary/40 bg-primary/5', !r.enabled && 'opacity-60')}>
                <span className="min-w-0">
                  <span className="flex items-center gap-1.5 text-sm font-medium"><span className="truncate">{r.title}</span><Count n={r.pendingProposals} tone="warning" /></span>
                  <span className="block truncate font-mono text-[11px] text-muted-foreground">{r.key} · {r.using.length} packs · {r.lessons} lessons</span>
                </span>
                <Meter role={r} />
              </button>
            ))}
          </div>
        ))}
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2">{role.title}<Tag className="font-mono">{role.key}</Tag>{!role.enabled && <Badge variant="slate">disabled</Badge>}{role.overLimit && <Badge variant="red">over the limit</Badge>}</CardTitle>
          <Meter role={role} wide />
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {role.stale.length > 0 && <p className="rounded-md border border-warning/30 bg-warning/10 p-2 text-xs">Switched on but no longer usable (deleted, or the audience changed): <span className="font-mono">{role.stale.join(', ')}</span>. The role does not read them.</p>}
          {section('Reading now', 'sent with every step of this role', role.using, 'using')}
          {section('Can use', 'allowed, switched off', role.available, 'available')}
          {section('Not allowed', "outside the pack's audience", role.blocked, 'blocked')}
          <Lessons role={role} items={own} packs={data.packs} max={data.limits.lessonsPerRole} onChanged={onChanged} />
          <SentText role={role} />
        </CardContent>
      </Card>
    </div>
  );
}

/** The exact context text a step of this role is sent after the role's own prompt (packs, what it was not given, lessons). */
function SentText({ role }: { role: RoleContext }) {
  const [open, setOpen] = useState(false);
  // keyed by the sizes too, so it is read again after a switch or a decision
  const q = useQuery({ queryKey: ['context', 'text', role.roleId, role.chars.context], queryFn: () => api<RoleContextText>(`/api/team/context/roles/${role.roleId}`), enabled: open });
  return (
    <div className="flex flex-col gap-2 border-t pt-3">
      <div className="flex items-baseline gap-2">
        <h3 className="text-sm font-semibold">What it is sent</h3>
        <span className="text-xs text-muted-foreground">the exact text added after the role's prompt, {n(role.chars.context)} characters</span>
        <Button size="sm" variant="ghost" onClick={() => setOpen(!open)}>{open ? 'Hide' : 'Show'}</Button>
      </div>
      {open && <QueryState isLoading={q.isLoading} error={q.error} />}
      {open && q.data && <div className="max-h-[32rem] overflow-y-auto rounded-md border bg-background p-3"><Markdown text={q.data.text || '_Nothing: this role reads only its own prompt._'} /></div>}
    </div>
  );
}

function Lessons({ role, items, packs, max, onChanged }: { role: RoleContext; items: Improvement[]; packs: ContextPack[]; max: number; onChanged: () => void }) {
  const [text, setText] = useState('');
  const approved = items.filter(i => i.status === 'approved' && i.kind === 'lesson').reverse();
  const waiting = items.filter(i => i.status === 'proposed');
  const add = useMutation({
    mutationFn: async () => {
      const p = await api<Improvement>(`/api/team/roles/${role.roleId}/improvements`, send('POST', { text, source: 'owner' }));
      return api(`/api/team/improvements/${p.id}/decision`, send('POST', { decision: 'approve' }));
    },
    onSuccess: () => (setText(''), onChanged()), onError: e => (onChanged(), fail(e)),
  });
  const retire = useMutation({ mutationFn: (id: string) => api(`/api/team/improvements/${id}/decision`, send('POST', { decision: 'retire' })), onSuccess: onChanged, onError: fail });
  return (
    <div className="flex flex-col gap-2 border-t pt-3">
      <div className="flex items-baseline gap-2">
        <h3 className="text-sm font-semibold">Lessons</h3><span className="font-mono text-xs text-muted-foreground">{approved.length} / {max}</span>
        <span className="text-xs text-muted-foreground">rules you approved; the role follows them from its next run</span>
      </div>
      {approved.map(i => (
        <div key={i.id} className="flex items-start gap-2 rounded-md border p-2 text-sm">
          <Check className="mt-0.5 size-3.5 shrink-0 text-success" />
          <div className="min-w-0 flex-1">{i.text}<Origin item={i} /></div>
          <Button size="sm" variant="ghost" disabled={retire.isPending} onClick={() => retire.mutate(i.id)}>Retire</Button>
        </div>
      ))}
      <form className="flex gap-2" onSubmit={e => (e.preventDefault(), text.trim().length >= 3 && add.mutate())}>
        <Input className="flex-1" value={text} maxLength={CONTEXT_LIMITS.lesson} onChange={e => setText(e.target.value)} placeholder="Add a lesson yourself: one rule, one or two sentences" />
        <Button type="submit" variant="secondary" disabled={add.isPending || text.trim().length < 3}>Add</Button>
      </form>
      {waiting.length > 0 && <h3 className="pt-1 text-sm font-semibold">Waiting for you <Count n={waiting.length} tone="warning" /></h3>}
      {waiting.map(i => <Proposal key={i.id} item={i} packs={packs} onChanged={onChanged} />)}
    </div>
  );
}

/** Where a proposal came from; a run step links to its run. */
function Origin({ item }: { item: Improvement }) {
  const run = /^run:([^:]+):(.+)$/.exec(item.source);
  return (
    <span className="block text-[11px] text-muted-foreground">
      {run ? <>from <Link to="/runs/$runId" params={{ runId: run[1]! }} className="underline">run step {run[2]}</Link></> : <>from {item.source}</>} · {new Date(item.createdAt).toLocaleString()}
    </span>
  );
}

const STATUS_BADGE: Record<ImprovementStatus, 'amber' | 'green' | 'red' | 'slate'> = { proposed: 'amber', approved: 'green', rejected: 'red', retired: 'slate' };

function Proposal({ item, packs, onChanged, showRole }: { item: Improvement; packs: ContextPack[]; onChanged: () => void; showRole?: boolean }) {
  const [text, setText] = useState(item.text);
  const [note, setNote] = useState('');
  const decide = useMutation({
    mutationFn: (decision: 'approve' | 'reject' | 'retire') =>
      api(`/api/team/improvements/${item.id}/decision`, send('POST', { decision, note, ...(decision === 'approve' && item.kind === 'lesson' && text.trim() !== item.text ? { text } : {}) })),
    onSuccess: onChanged, onError: fail,
  });
  const open = item.status === 'proposed';
  const pack = packs.find(p => p.slug === item.pack);
  const outside = item.kind === 'context' && pack !== undefined && !packAllows(pack, item.roleKey);
  return (
    <div className="flex flex-col gap-2 rounded-md border p-3">
      <div className="flex flex-wrap items-center gap-1.5">
        {showRole && <Tag className="font-mono">{item.roleKey}</Tag>}
        <Badge variant={item.kind === 'context' ? 'indigo' : 'purple'}>{item.kind === 'context' ? 'asks for context' : 'lesson'}</Badge>
        <Badge variant={STATUS_BADGE[item.status]}>{item.status === 'proposed' ? 'waiting for you' : item.status}</Badge>
      </div>
      {item.kind === 'context' && <p className="text-sm">Wants to read <span className="font-medium">{pack?.name ?? item.pack}</span> <Tag className="font-mono">{item.pack}</Tag>{!pack && <span className="text-destructive"> (no such pack now)</span>}</p>}
      {outside && open && <p className="rounded-md border border-warning/30 bg-warning/10 p-2 text-xs">{item.roleKey} is outside this pack's audience. To allow it, add the role to the pack's audience first (Matrix, click the pack), then approve.</p>}
      {open && item.kind === 'lesson'
        ? <textarea className="min-h-16 rounded-md border bg-background p-2 text-sm" value={text} maxLength={CONTEXT_LIMITS.lesson} onChange={e => setText(e.target.value)} title="You can reword the rule before approving it" />
        : <p className="text-sm">{item.text}</p>}
      {item.reason && item.reason !== item.text && <p className="text-xs text-muted-foreground">Why: {item.reason}</p>}
      {item.note && <p className="text-xs">Your note: {item.note}</p>}
      <Origin item={item} />
      {open && (
        <div className="flex flex-wrap items-center gap-2">
          <Input className="min-w-48 flex-1" value={note} maxLength={CONTEXT_LIMITS.note} onChange={e => setNote(e.target.value)} placeholder="Note (when rejected, the role sees it and does not propose this again)" />
          <Button size="sm" disabled={decide.isPending || outside || (item.kind === 'context' && !pack)} onClick={() => decide.mutate('approve')}><Check className="size-3.5" />{item.kind === 'context' ? 'Approve and switch on' : 'Approve'}</Button>
          <Button size="sm" variant="secondary" disabled={decide.isPending} onClick={() => decide.mutate('reject')}><X className="size-3.5" />Reject</Button>
        </div>
      )}
      {item.status === 'approved' && item.kind === 'lesson' && <div><Button size="sm" variant="ghost" disabled={decide.isPending} onClick={() => decide.mutate('retire')}>Retire</Button></div>}
      {(item.status === 'rejected' || item.status === 'retired') && <div><Button size="sm" variant="ghost" disabled={decide.isPending} onClick={() => decide.mutate('approve')}>Approve after all</Button></div>}
    </div>
  );
}

function Proposals({ items, packs, onChanged }: { items: Improvement[]; packs: ContextPack[]; onChanged: () => void }) {
  const [status, setStatus] = useState<ImprovementStatus>('proposed');
  const shown = items.filter(i => i.status === status);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-1.5">
        {IMPROVEMENT_STATUSES.map(s => (
          <FilterChip key={s} active={status === s} onClick={() => setStatus(s)}>{s === 'proposed' ? 'Waiting for you' : s[0]!.toUpperCase() + s.slice(1)}<Count n={items.filter(i => i.status === s).length} tone={s === 'proposed' ? 'warning' : 'neutral'} /></FilterChip>
        ))}
      </div>
      {!shown.length && (
        <p className="p-4 text-sm text-muted-foreground">
          {status === 'proposed' ? 'Nothing waiting. A role-driven step may end its report with "Improvement proposals"; they land here, and change nothing until you approve.' : 'Nothing here.'}
        </p>
      )}
      {shown.map(i => <Proposal key={i.id} item={i} packs={packs} onChanged={onChanged} showRole />)}
    </div>
  );
}

const CELL: Record<ContextState, { label: string; className: string; icon: ReactNode }> = {
  pinned: { label: 'always on', className: 'text-info', icon: <Lock className="size-3.5" /> },
  on: { label: 'on: click to switch off', className: 'text-success', icon: <Check className="size-4" /> },
  off: { label: 'allowed, off: click to switch on', className: 'text-muted-foreground/40', icon: <span className="text-base leading-none">○</span> },
  blocked: { label: "not allowed (outside the pack's audience)", className: 'text-muted-foreground/40', icon: <Ban className="size-3.5" /> },
};

function Matrix({ data, busy, onToggle, onEditPack }: { data: ContextOverview; busy: boolean; onToggle: (role: RoleContext, slug: string, on: boolean) => void; onEditPack: (p: ContextPack) => void }) {
  if (!data.packs.length) return <p className="p-4 text-sm text-muted-foreground">No context packs yet. Add one with “Pack”, or push them from a repository (see docs/specs/0007-context.md).</p>;
  const stateOf = (p: ContextPack, r: RoleContext) => contextState(p, r.key, r.using);
  // a role no pack lets in (another project's role) would be a column of "not allowed": left out, counted below
  const roles = data.roles.filter(r => r.using.length + r.available.length > 0);
  const hidden = data.roles.length - roles.length;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
        {(Object.keys(CELL) as ContextState[]).map(s => <span key={s} className="inline-flex items-center gap-1"><span className={CELL[s].className}>{CELL[s].icon}</span>{CELL[s].label.split(':')[0]}</span>)}
      </div>
      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <THead>
            <Tr>
              <Th className="min-w-64">Pack</Th>
              {roles.map(r => <Th key={r.key} className="min-w-24 text-center align-bottom" title={r.key}>{r.title}<span className="block font-mono text-[10px] font-normal">{r.key}</span></Th>)}
            </Tr>
          </THead>
          <TBody>
            {data.packs.map(p => (
              <Tr key={p.slug}>
                <Td className="min-w-64">
                  <button className="text-left hover:underline" onClick={() => onEditPack(p)}>
                    <span className="text-sm font-medium">{p.name}</span>
                    <span className="block font-mono text-[11px] text-muted-foreground">{p.slug} · {n(p.chars)} chars{p.pinned ? ' · always on' : ''}{p.audience ? ` · ${p.audience.length} roles` : ''}</span>
                  </button>
                </Td>
                {roles.map(r => {
                  const s = stateOf(p, r);
                  const c = CELL[s];
                  const can = s === 'on' || s === 'off';
                  return (
                    <Td key={r.key} className="text-center">
                      <button disabled={!can || busy} title={`${r.title}: ${c.label}`} aria-label={`${p.name} for ${r.title}: ${c.label}`} onClick={() => onToggle(r, p.slug, s === 'off')}
                        className={cn('inline-flex size-7 items-center justify-center rounded-md', c.className, can && 'hover:bg-accent')}>{c.icon}</button>
                    </Td>
                  );
                })}
              </Tr>
            ))}
            <Tr>
              <Td className="text-xs text-muted-foreground">Reads in total (prompt + context, limit {n(data.limits.roleChars)})</Td>
              {roles.map(r => <Td key={r.key} className={cn('text-center font-mono text-[11px] tabular-nums', r.overLimit ? 'text-destructive' : 'text-muted-foreground')}>{n(r.chars.prompt + r.chars.context)}</Td>)}
            </Tr>
          </TBody>
        </Table>
      </div>
      {hidden > 0 && <p className="text-xs text-muted-foreground">{hidden} {hidden === 1 ? 'role is' : 'roles are'} outside every pack's audience and not shown here (see By role).</p>}
    </div>
  );
}

function PackDialog({ pack, roles, onClose, onSaved }: { pack?: ContextPack; roles: RoleContext[]; onClose: () => void; onSaved: () => void }) {
  const [slug, setSlug] = useState(pack?.slug ?? '');
  const [f, setF] = useState({ name: pack?.name ?? '', description: pack?.description ?? '', source: pack?.source ?? '', body: pack?.body ?? '', pinned: pack?.pinned ?? false, audience: pack?.audience ?? null as string[] | null });
  const [preview, setPreview] = useState(Boolean(pack));
  const done = () => (onSaved(), onClose());
  const save = useMutation({ mutationFn: () => api(`/api/team/context/packs/${encodeURIComponent(slug.trim())}`, send('PUT', f)), onSuccess: done });
  const remove = useMutation({ mutationFn: () => api(`/api/team/context/packs/${pack!.slug}`, send('DELETE')), onSuccess: done });
  const everyone = f.audience === null;
  const flip = (key: string) => setF({ ...f, audience: f.audience!.includes(key) ? f.audience!.filter(k => k !== key) : [...f.audience!, key] });
  const error = (save.error ?? remove.error) as Error | null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" onMouseDown={onClose}>
      <div className="flex max-h-[92vh] w-full max-w-3xl flex-col gap-3 overflow-y-auto rounded-xl border bg-card p-4 shadow-xl" onMouseDown={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="font-semibold">{pack ? pack.name : 'New context pack'}</h3>
          <button className="rounded p-1 hover:bg-accent" onClick={onClose} title="Close"><X className="size-4" /></button>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-xs">Name<Input autoFocus={!pack} value={f.name} onChange={e => setF({ ...f, name: e.target.value })} /></label>
          <label className="flex flex-col gap-1 text-xs">Slug<Input value={slug} disabled={Boolean(pack)} onChange={e => setSlug(e.target.value)} placeholder="project-facts" /></label>
          <label className="flex flex-col gap-1 text-xs sm:col-span-2">What is in it (one line)<Input value={f.description} onChange={e => setF({ ...f, description: e.target.value })} /></label>
          <label className="flex flex-col gap-1 text-xs sm:col-span-2">Source (file, document, date)<Input value={f.source} onChange={e => setF({ ...f, source: e.target.value })} /></label>
        </div>
        <div className="flex flex-col gap-1.5 text-xs">
          <span>Who may read it</span>
          <div className="flex flex-wrap gap-1.5">
            <FilterChip active={everyone} onClick={() => setF({ ...f, audience: everyone ? [] : null })}>Every role</FilterChip>
            {!everyone && roles.map(r => <FilterChip key={r.key} active={f.audience!.includes(r.key)} onClick={() => flip(r.key)} title={r.key}>{r.title}</FilterChip>)}
          </div>
          <label className="flex items-center gap-2 pt-1"><input type="checkbox" checked={f.pinned} onChange={e => setF({ ...f, pinned: e.target.checked })} />Always on for those roles (shared memory: cannot be switched off per role)</label>
        </div>
        <div className="flex flex-col gap-1 text-xs">
          <div className="flex items-center justify-between">
            <span>Body (Markdown) · <span className={cn('font-mono', f.body.length > CONTEXT_LIMITS.body && 'text-destructive')}>{n(f.body.length)} / {n(CONTEXT_LIMITS.body)}</span>. Never put tokens or passwords here.</span>
            <Button size="sm" variant="ghost" onClick={() => setPreview(!preview)}>{preview ? 'Edit' : 'Preview'}</Button>
          </div>
          {preview
            ? <div className="max-h-96 overflow-y-auto rounded-md border bg-background p-3"><Markdown text={f.body || '_empty_'} /></div>
            : <textarea className="min-h-72 rounded-md border bg-background p-2 font-mono text-xs" value={f.body} onChange={e => setF({ ...f, body: e.target.value })} />}
        </div>
        {error && <p className="text-sm text-destructive">{error.message}</p>}
        <div className="flex justify-between gap-2">
          {pack ? <Button variant="ghost" disabled={remove.isPending} onClick={() => confirm(`Delete the pack "${pack.name}"? Roles stop reading it.`) && remove.mutate()}><Trash2 className="size-3.5" />Delete</Button> : <span />}
          <div className="flex gap-2">
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
            <Button disabled={save.isPending || !slug.trim() || !f.name.trim()} onClick={() => save.mutate()}>Save</Button>
          </div>
        </div>
      </div>
    </div>
  );
}
