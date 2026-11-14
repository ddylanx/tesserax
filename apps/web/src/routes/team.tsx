import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { Activity, History, LayoutGrid, Pencil, Plus, Trash2, X } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import {
  AI_ENGINES, AI_ENGINE_TITLES, AI_MODEL_SUGGESTIONS, ROLE_LIMITS, ROLE_TOOL_ALLOWLIST,
  type AiEngine, type Department, type McpServerPolicyDto, type ReportLanguage, type Role, type RoleChange, type RoleConfig, type TeamList,
} from '@tesserax/contracts';
import { MarkdownPanel } from '@/components/markdown';
import { TeamLive } from '@/components/team-live';
import { Page, QueryState } from '@/components/page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/input';
import { api } from '@/lib/api';
import { useProjectScope } from '@/lib/project-context';

const post = (method: string, body?: unknown) => ({ method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

export function TeamPage() {
  const scope = useProjectScope();
  const qc = useQueryClient();
  const team = useQuery({ queryKey: ['team', scope.scopeParam], queryFn: () => api<TeamList>(`/api/team${scope.scopeParam ? `?${scope.scopeParam}` : ''}`) });
  const [editDept, setEditDept] = useState<Department | 'new' | null>(null);
  const [editRole, setEditRole] = useState<{ role?: Role; departmentId?: string } | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ['team'] });
  const removeDept = useMutation({ mutationFn: (id: string) => api(`/api/team/departments/${id}`, post('DELETE')), onSuccess: refresh, onError: e => alert((e as Error).message) });
  const removeRole = useMutation({ mutationFn: (id: string) => api(`/api/team/roles/${id}`, post('DELETE')), onSuccess: refresh, onError: e => alert((e as Error).message) });

  const departments = team.data?.departments ?? [];
  const roles = team.data?.roles ?? [];
  const { view } = useSearch({ from: '/team' });
  const navigate = useNavigate({ from: '/team' });
  const live = view === 'live';
  const toggle = (
    <div className="flex rounded-md border p-0.5">
      <Button size="sm" variant={live ? 'ghost' : 'default'} onClick={() => navigate({ search: {} })}><LayoutGrid className="size-3.5" />Roles</Button>
      <Button size="sm" variant={live ? 'default' : 'ghost'} onClick={() => navigate({ search: { view: 'live' } })}><Activity className="size-3.5" />Live</Button>
    </div>
  );
  if (live) {
    return (
      <Page
        title="Team"
        description={<>What each role is doing right now: the task and step it is on, how long it has run, its last lines of output and its last report. Refreshes every few seconds; click a step to open its run.{scope.current && <> Only {scope.current.name}.</>}</>}
        actions={toggle}
      >
        <QueryState isLoading={team.isLoading} error={team.error} />
        {team.data && <TeamLive departments={departments} roles={roles} scopeParam={scope.scopeParam} />}
      </Page>
    );
  }
  return (
    <Page
      title="Team"
      description={<>Departments and the roles in them. A workflow node names a role (<code>department/role</code>) to take its prompt, engine, model, skills, tools and MCP servers; anything the node sets itself wins.{scope.current && <> Showing the roles {scope.current.name} allows.</>}</>}
      actions={<div className="flex gap-2">{toggle}<Button onClick={() => setEditDept('new')}><Plus className="size-3.5" />Department</Button></div>}
    >
      <QueryState isLoading={team.isLoading} error={team.error} empty={!departments.length} emptyText="No departments yet." />
      {departments.map(d => {
        const own = roles.filter(r => r.departmentId === d.id);
        return (
          <section key={d.id} className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-block size-2.5 rounded-full" style={{ backgroundColor: d.color }} />
              <h2 className="font-semibold">{d.name}</h2>
              <span className="font-mono text-xs text-muted-foreground">{d.slug}</span>
              {d.description && <span className="text-sm text-muted-foreground">· {d.description}</span>}
              <div className="ml-auto flex gap-1">
                <Button size="sm" variant="outline" onClick={() => setEditRole({ departmentId: d.id })}><Plus className="size-3.5" />Role</Button>
                <Button size="sm" variant="ghost" onClick={() => setEditDept(d)} title="Edit department"><Pencil className="size-3.5" /></Button>
                <Button size="sm" variant="ghost" title="Delete department" onClick={() => confirm(`Delete the department ${d.name}?`) && removeDept.mutate(d.id)}><Trash2 className="size-3.5" /></Button>
              </div>
            </div>
            {own.length ? (
              <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                {own.map(r => <RoleCard key={r.id} role={r} onEdit={() => setEditRole({ role: r })} onDelete={() => confirm(`Delete the role ${r.key}?`) && removeRole.mutate(r.id)} />)}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">{scope.current ? `No roles here that ${scope.current.name} allows.` : 'No roles yet.'}</p>
            )}
          </section>
        );
      })}
      {editDept && <DepartmentDialog department={editDept === 'new' ? undefined : editDept} onClose={() => setEditDept(null)} onSaved={refresh} />}
      {editRole && <RoleDialog role={editRole.role} departmentId={editRole.departmentId} departments={departments} onClose={() => setEditRole(null)} onSaved={refresh} />}
    </Page>
  );
}

function RoleCard({ role, onEdit, onDelete }: { role: Role; onEdit: () => void; onDelete: () => void }) {
  const c = role.config as Partial<RoleConfig>;
  const [history, setHistory] = useState(false);
  return (
    <Card className={role.enabled ? '' : 'opacity-60'}>
      <CardHeader>
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <CardTitle>{role.title}</CardTitle>
            <span className="font-mono text-xs text-muted-foreground">{role.key}</span>
          </div>
          <Button size="sm" variant="ghost" onClick={onEdit} title="Edit role"><Pencil className="size-3.5" /></Button>
          <Button size="sm" variant="ghost" onClick={onDelete} title="Delete role"><Trash2 className="size-3.5" /></Button>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 text-xs">
        {c.mission && <p className="text-sm">{c.mission}</p>}
        {(c.whenToUse?.length ?? 0) > 0 && <p className="text-muted-foreground"><b className="font-medium text-foreground">Use for:</b> {c.whenToUse!.join(' · ')}</p>}
        {(c.notFor?.length ?? 0) > 0 && <p className="text-muted-foreground"><b className="font-medium text-foreground">Not for:</b> {c.notFor!.join(' · ')}</p>}
        {(c.inputsNeeded?.length ?? 0) > 0 && <p className="text-muted-foreground"><b className="font-medium text-foreground">Needs:</b> {c.inputsNeeded!.join(' · ')}</p>}
        <div className="flex flex-wrap gap-1">
          {c.reportLanguage === 'vi' && <Badge variant="outline" title="Reports in Vietnamese">vi</Badge>}
          {!role.enabled && <Badge variant="slate">disabled</Badge>}
          {c.engine && <Badge variant="indigo">{AI_ENGINE_TITLES[c.engine as AiEngine] ?? c.engine}</Badge>}
          {c.model && <Badge variant="blue">{c.model}</Badge>}
          {c.executor && <Badge variant="purple">{c.executor}</Badge>}
          {role.problems.length > 0 && <Badge variant="red" title={role.problems.join('\n')}>{role.problems.length} problems</Badge>}
        </div>
        {(c.skills?.length ?? 0) > 0 && <div className="flex flex-wrap gap-1">{c.skills!.map(s => <Badge key={s} variant="outline">{s.replace(/^skills\//, '').replace(/\/SKILL\.md$/, '')}</Badge>)}</div>}
        <div className="flex flex-wrap items-center gap-2 text-muted-foreground">
          <span title={role.usedBy.join(', ') || undefined}>used by {role.usedBy.length} workflow{role.usedBy.length === 1 ? '' : 's'}</span>
          <span className="font-mono" title="Version of prompt + config; stored on each step that used it">#{role.hash}</span>
          <button className="ml-auto inline-flex items-center gap-1 hover:text-foreground" onClick={() => setHistory(h => !h)}><History className="size-3" />History</button>
        </div>
        {history && <RoleHistory id={role.id} />}
      </CardContent>
    </Card>
  );
}

function RoleHistory({ id }: { id: string }) {
  const q = useQuery({ queryKey: ['team', 'changes', id], queryFn: () => api<{ changes: RoleChange[] }>(`/api/team/roles/${id}/changes`) });
  if (q.isLoading || q.error) return <QueryState isLoading={q.isLoading} error={q.error} />;
  return (
    <ul className="flex max-h-40 flex-col gap-0.5 overflow-y-auto rounded-md border bg-muted/40 p-2 font-mono">
      {q.data!.changes.map(c => (
        <li key={c.id}>{new Date(c.at).toLocaleString()} · {c.action} · {c.oldHash ?? '∅'} → {c.newHash ?? '∅'}</li>
      ))}
    </ul>
  );
}

function Dialog({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" onMouseDown={onClose}>
      <div className={`flex max-h-[92vh] w-full ${wide ? 'max-w-3xl' : 'max-w-lg'} flex-col gap-3 overflow-y-auto rounded-xl border bg-card p-4 shadow-xl`} onMouseDown={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="font-semibold">{title}</h3>
          <button className="rounded p-1 hover:bg-accent" onClick={onClose} title="Close"><X className="size-4" /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

function DepartmentDialog({ department, onClose, onSaved }: { department?: Department; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ slug: department?.slug ?? '', name: department?.name ?? '', color: department?.color ?? '#64748b', description: department?.description ?? '' });
  const save = useMutation({
    mutationFn: () => (department ? api(`/api/team/departments/${department.id}`, post('PATCH', f)) : api('/api/team/departments', post('POST', f))),
    onSuccess: () => (onSaved(), onClose()),
  });
  return (
    <Dialog title={department ? `Edit ${department.name}` : 'New department'} onClose={onClose}>
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-xs">Name<Input autoFocus value={f.name} onChange={e => setF({ ...f, name: e.target.value })} /></label>
        <label className="flex flex-col gap-1 text-xs">Slug (used in role keys)<Input value={f.slug} onChange={e => setF({ ...f, slug: e.target.value })} placeholder="engineering" /></label>
        <label className="flex flex-col gap-1 text-xs">Color<Input type="color" value={f.color} onChange={e => setF({ ...f, color: e.target.value })} /></label>
        <label className="flex flex-col gap-1 text-xs sm:col-span-2">Description<Input value={f.description} onChange={e => setF({ ...f, description: e.target.value })} /></label>
      </div>
      {save.error && <p className="text-sm text-destructive">{(save.error as Error).message}</p>}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button disabled={!f.name.trim() || !f.slug.trim() || save.isPending} onClick={() => save.mutate()}>Save</Button>
      </div>
    </Dialog>
  );
}

interface RoleForm {
  departmentId: string; slug: string; title: string; enabled: boolean; prompt: string;
  engine: string; model: string; executor: string; skills: string[]; allowedTools: string[] | null; mcpServers: string[]; maxBudgetUsd: string; timeoutSeconds: string;
  /** Descriptor; the three lists are edited one item per line. */
  mission: string; whenToUse: string; notFor: string; inputsNeeded: string; reportLanguage: ReportLanguage;
}

const lines = (s: string) => s.split('\n').map(l => l.trim()).filter(Boolean);

const toForm = (role: Role | undefined, departmentId: string): RoleForm => {
  const c = (role?.config ?? {}) as Partial<RoleConfig>;
  return {
    departmentId: role?.departmentId ?? departmentId, slug: role?.slug ?? '', title: role?.title ?? '', enabled: role?.enabled ?? true, prompt: role?.prompt ?? '',
    engine: c.engine ?? '', model: c.model ?? '', executor: c.executor ?? '', skills: c.skills ?? [], allowedTools: c.allowedTools ?? null,
    mcpServers: c.mcp?.servers ?? [], maxBudgetUsd: c.maxBudgetUsd?.toString() ?? '', timeoutSeconds: c.timeoutSeconds?.toString() ?? '',
    mission: c.mission ?? '', whenToUse: (c.whenToUse ?? []).join('\n'), notFor: (c.notFor ?? []).join('\n'), inputsNeeded: (c.inputsNeeded ?? []).join('\n'),
    reportLanguage: c.reportLanguage ?? 'en',
  };
};

/** Only the fields that are set, so the node's own value or its type's default applies to the rest. */
function toBody(f: RoleForm, keep: Record<string, unknown>) {
  const config: Record<string, unknown> = { skills: f.skills };
  if (f.engine) config.engine = f.engine;
  if (f.model.trim()) config.model = f.model.trim();
  if (f.executor) config.executor = f.executor;
  if (f.allowedTools) config.allowedTools = f.allowedTools;
  if (f.mcpServers.length || keep.mcp) config.mcp = { ...(keep.mcp as object), servers: f.mcpServers };
  if (f.maxBudgetUsd.trim()) config.maxBudgetUsd = Number(f.maxBudgetUsd);
  if (f.timeoutSeconds.trim()) config.timeoutSeconds = Number(f.timeoutSeconds);
  if (f.mission.trim()) config.mission = f.mission.trim();
  for (const k of ['whenToUse', 'notFor', 'inputsNeeded'] as const) if (lines(f[k]).length) config[k] = lines(f[k]);
  config.reportLanguage = f.reportLanguage;
  // the packs switched on for the role are edited on the Context page; saving the role here must not drop them
  if (Array.isArray(keep.context)) config.context = keep.context;
  return { departmentId: f.departmentId, slug: f.slug.trim(), title: f.title.trim(), enabled: f.enabled, prompt: f.prompt, config };
}

function toggle(list: string[], v: string) {
  return list.includes(v) ? list.filter(x => x !== v) : [...list, v];
}

function RoleDialog({ role, departmentId, departments, onClose, onSaved }: { role?: Role; departmentId?: string; departments: Department[]; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState(() => toForm(role, departmentId ?? departments[0]?.id ?? ''));
  const set = <K extends keyof RoleForm>(k: K, v: RoleForm[K]) => setF(prev => ({ ...prev, [k]: v }));
  const skills = useQuery({ queryKey: ['skills', 'list'], queryFn: () => api<{ path: string; name: string }[]>('/api/skills') });
  const mcp = useQuery({ queryKey: ['mcp', 'policy'], queryFn: () => api<McpServerPolicyDto[]>('/api/mcp/policy') });
  const mcpNames = [...new Set((mcp.data ?? []).map(s => s.name))].sort();
  const save = useMutation({
    mutationFn: () => {
      const body = toBody(f, (role?.config ?? {}) as Record<string, unknown>);
      return role ? api(`/api/team/roles/${role.id}`, post('PATCH', body)) : api('/api/team/roles', post('POST', body));
    },
    onSuccess: () => (onSaved(), onClose()),
  });
  const suggestions = f.engine ? AI_MODEL_SUGGESTIONS[f.engine as AiEngine] ?? [] : [...new Set(Object.values(AI_MODEL_SUGGESTIONS).flat())];
  return (
    <Dialog title={role ? `Edit ${role.key}` : 'New role'} onClose={onClose} wide>
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-xs">Title<Input autoFocus value={f.title} onChange={e => set('title', e.target.value)} placeholder="Backend developer" /></label>
        <label className="flex flex-col gap-1 text-xs">Slug (key: department/slug)<Input value={f.slug} onChange={e => set('slug', e.target.value)} placeholder="backend-dev" /></label>
        <label className="flex flex-col gap-1 text-xs">Department
          <Select value={f.departmentId} onChange={e => set('departmentId', e.target.value)}>
            {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
          </Select>
        </label>
        <label className="flex items-center gap-2 self-end text-xs"><input type="checkbox" checked={f.enabled} onChange={e => set('enabled', e.target.checked)} />Enabled (a disabled role fails the steps that name it)</label>
        <label className="flex flex-col gap-1 text-xs">Engine
          <Select value={f.engine} onChange={e => set('engine', e.target.value)}>
            <option value="">(node or project default)</option>
            {AI_ENGINES.map(e => <option key={e} value={e}>{AI_ENGINE_TITLES[e]}</option>)}
          </Select>
        </label>
        <label className="flex flex-col gap-1 text-xs">Model
          <Input list="role-models" value={f.model} onChange={e => set('model', e.target.value)} placeholder="(CLI default)" />
          <datalist id="role-models">{suggestions.map(m => <option key={m} value={m} />)}</datalist>
        </label>
        <label className="flex flex-col gap-1 text-xs">Max budget (USD, at most {ROLE_LIMITS.maxBudgetUsd})<Input type="number" min={0} max={ROLE_LIMITS.maxBudgetUsd} step="0.5" value={f.maxBudgetUsd} onChange={e => set('maxBudgetUsd', e.target.value)} /></label>
        <label className="flex flex-col gap-1 text-xs">Timeout (seconds, at most {ROLE_LIMITS.timeoutSeconds})<Input type="number" min={1} max={ROLE_LIMITS.timeoutSeconds} value={f.timeoutSeconds} onChange={e => set('timeoutSeconds', e.target.value)} /></label>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-xs sm:col-span-2">Mission (what this role is for, at most {ROLE_LIMITS.mission} characters)
          <Input value={f.mission} maxLength={ROLE_LIMITS.mission} onChange={e => set('mission', e.target.value)} placeholder="Implement a well-specified change with tests, as small local commits." />
        </label>
        {([['whenToUse', 'Use this role for'], ['notFor', 'Not for'], ['inputsNeeded', 'Inputs it needs']] as const).map(([k, label]) => (
          <label key={k} className="flex flex-col gap-1 text-xs">{label} <span className="text-muted-foreground">(one per line, at most {ROLE_LIMITS.briefItems})</span>
            <textarea className="min-h-16 rounded-md border bg-background p-2 text-xs" value={f[k]} onChange={e => set(k, e.target.value)} />
          </label>
        ))}
        <label className="flex flex-col gap-1 text-xs">Report language
          <Select value={f.reportLanguage} onChange={e => set('reportLanguage', e.target.value as ReportLanguage)}>
            <option value="en">English</option>
            <option value="vi">Tiếng Việt</option>
          </Select>
        </label>
      </div>

      <fieldset className="flex flex-col gap-1 text-xs">
        <legend className="mb-1">Skills (added before the node's own)</legend>
        <div className="flex max-h-28 flex-wrap gap-x-3 gap-y-1 overflow-y-auto rounded-md border p-2">
          {(skills.data ?? []).map(s => (
            <label key={s.path} className="flex items-center gap-1"><input type="checkbox" checked={f.skills.includes(s.path)} onChange={() => set('skills', toggle(f.skills, s.path))} />{s.name}</label>
          ))}
          {f.skills.filter(p => !skills.data?.some(s => s.path === p)).map(p => (
            <label key={p} className="flex items-center gap-1 text-destructive"><input type="checkbox" checked onChange={() => set('skills', toggle(f.skills, p))} />{p} (missing)</label>
          ))}
          {!skills.data?.length && <span className="text-muted-foreground">No skills found.</span>}
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-1 text-xs">
        <legend className="mb-1 flex items-center gap-2">
          <label className="flex items-center gap-1"><input type="checkbox" checked={f.allowedTools !== null} onChange={e => set('allowedTools', e.target.checked ? ['Read', 'Grep', 'Glob'] : null)} />Limit tools</label>
          <span className="text-muted-foreground">(the role can only narrow what a node allows; unchecked = the node's tools)</span>
        </legend>
        {f.allowedTools && (
          <div className="flex flex-wrap gap-x-3 gap-y-1 rounded-md border p-2 font-mono">
            {ROLE_TOOL_ALLOWLIST.map(t => (
              <label key={t} className="flex items-center gap-1"><input type="checkbox" checked={f.allowedTools!.includes(t)} onChange={() => set('allowedTools', toggle(f.allowedTools!, t))} />{t}</label>
            ))}
          </div>
        )}
      </fieldset>

      <fieldset className="flex flex-col gap-1 text-xs">
        <legend className="mb-1">MCP servers to request (the MCP page's policy still decides what is granted)</legend>
        <div className="flex flex-wrap gap-x-3 gap-y-1 rounded-md border p-2">
          {mcpNames.map(n => <label key={n} className="flex items-center gap-1"><input type="checkbox" checked={f.mcpServers.includes(n)} onChange={() => set('mcpServers', toggle(f.mcpServers, n))} />{n}</label>)}
          {!mcpNames.length && <span className="text-muted-foreground">No MCP servers found.</span>}
        </div>
      </fieldset>

      <div className="flex flex-col gap-1 text-xs">
        <span>Prompt (markdown, placed before the skills and the step's prompt)</span>
        <MarkdownPanel text={f.prompt} onChange={v => set('prompt', v)} startInSource={!f.prompt} maxHeight="max-h-72" />
        <span className={f.prompt.length > ROLE_LIMITS.prompt ? 'text-destructive' : 'text-muted-foreground'}>{f.prompt.length} / {ROLE_LIMITS.prompt} characters. Never put tokens or passwords here.</span>
      </div>

      {save.error && <p className="whitespace-pre-wrap text-sm text-destructive">{(save.error as Error).message}</p>}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button disabled={!f.title.trim() || !f.slug.trim() || !f.departmentId || save.isPending} onClick={() => save.mutate()}>Save</Button>
      </div>
    </Dialog>
  );
}
