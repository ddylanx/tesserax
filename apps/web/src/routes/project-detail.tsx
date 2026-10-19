import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from '@tanstack/react-router';
import { Plus, Save, Trash2, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { AI_ENGINES, type Project, type ProjectSettings, type RepoInspection, type TaskList, type WorkflowRunList } from '@tesserax/contracts';
import { Page, QueryState } from '@/components/page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/input';
import { useRepoRegistry, workplaceLabel } from '@/components/workplace';
import { api } from '@/lib/api';
import { timeAgo } from '@/lib/utils';

const list = (s: string) => s.split(/[\s,]+/).map(x => x.trim()).filter(Boolean);

type Tab = 'overview' | 'settings';

export function ProjectDetailPage() {
  const { slug } = useParams({ from: '/projects/$slug' });
  const [tab, setTab] = useState<Tab>('overview');
  const q = useQuery({ queryKey: ['project', slug], queryFn: () => api<Project>(`/api/projects/${slug}`) });
  return (
    <Page
      title={q.data?.name ?? slug}
      description={<Link to="/projects" className="hover:underline">← all projects</Link>}
      actions={
        <div className="flex rounded-md border bg-muted/50 p-0.5 text-xs">
          {(['overview', 'settings'] as const).map(t => (
            <button key={t} type="button" onClick={() => setTab(t)} className={`rounded px-3 py-1 font-medium capitalize ${tab === t ? 'bg-background shadow-2xs' : 'text-muted-foreground'}`}>{t}</button>
          ))}
        </div>
      }
    >
      <QueryState isLoading={q.isLoading} error={q.error} />
      {q.data && (tab === 'overview' ? <Overview project={q.data} /> : <Settings key={q.data.id} project={q.data} />)}
    </Page>
  );
}

function Overview({ project }: { project: Project }) {
  const tasks = useQuery({ queryKey: ['tasks', 'project', project.slug], queryFn: () => api<TaskList>(`/api/tasks?project=${project.slug}&statusCategory=in_progress`), refetchInterval: 15_000 });
  const waiting = useQuery({ queryKey: ['wf', 'runs', 'waiting', project.slug], queryFn: () => api<WorkflowRunList>(`/api/workflow-runs?status=waiting&project=${project.slug}`), refetchInterval: 5_000 });
  const failed = useQuery({ queryKey: ['wf', 'runs', 'failed', project.slug], queryFn: () => api<WorkflowRunList>(`/api/workflow-runs?status=failed&project=${project.slug}`), refetchInterval: 15_000 });
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader><CardTitle>Waiting for you ({waiting.data?.runs.length ?? 0})</CardTitle></CardHeader>
        <CardContent className="flex flex-col gap-1.5 text-sm">
          {waiting.data?.runs.length === 0 && <p className="text-muted-foreground">Nothing is waiting.</p>}
          {waiting.data?.runs.map(r => (
            <Link key={r.id} to="/runs/$runId" params={{ runId: r.id }} className="flex items-center gap-2 hover:underline">
              <b>{r.task.key}</b> <span className="truncate">{r.task.title}</span> <Badge variant="amber">{r.currentNodeLabel ?? r.status}</Badge>
            </Link>
          ))}
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Failed runs ({failed.data?.runs.length ?? 0})</CardTitle></CardHeader>
        <CardContent className="flex flex-col gap-1.5 text-sm">
          {failed.data?.runs.length === 0 && <p className="text-muted-foreground">No failed runs.</p>}
          {failed.data?.runs.map(r => (
            <Link key={r.id} to="/runs/$runId" params={{ runId: r.id }} className="flex items-center gap-2 hover:underline">
              <b>{r.task.key}</b> <span className="truncate">{r.task.title}</span> <span className="text-xs text-muted-foreground">{timeAgo(r.updatedAt)}</span>
            </Link>
          ))}
        </CardContent>
      </Card>
      <Card className="lg:col-span-2">
        <CardHeader><CardTitle>Tasks in progress ({tasks.data?.tasks.length ?? 0})</CardTitle></CardHeader>
        <CardContent className="flex flex-col gap-1.5 text-sm">
          {tasks.data?.tasks.length === 0 && <p className="text-muted-foreground">No task is in progress.</p>}
          {tasks.data?.tasks.map(t => <div key={t.id} className="flex items-center gap-2"><b>{t.key}</b> <span className="truncate">{t.title}</span> {t.assignee && <span className="text-xs text-muted-foreground">{t.assignee}</span>}</div>)}
        </CardContent>
      </Card>
    </div>
  );
}

/** A checkbox list where "all" (null) means nothing is restricted. */
function PickList({ title, hint, options, value, onChange }: {
  title: string; hint: string; options: { id: string; label: string }[]; value: string[] | null; onChange: (v: string[] | null) => void;
}) {
  const all = value === null;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="text-xs font-medium">{title} <span className="font-normal text-muted-foreground">· {hint}</span></div>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={all} onChange={e => onChange(e.target.checked ? null : options.map(o => o.id))} />All</label>
      {!all && options.map(o => (
        <label key={o.id} className="flex items-center gap-2 pl-4 text-sm">
          <input type="checkbox" checked={value.includes(o.id)} onChange={e => onChange(e.target.checked ? [...value, o.id] : value.filter(x => x !== o.id))} />
          {o.label}
        </label>
      ))}
    </div>
  );
}

function Settings({ project }: { project: Project }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [name, setName] = useState(project.name);
  const [color, setColor] = useState(project.color);
  const [kind, setKind] = useState(project.kind);
  const [s, setS] = useState<ProjectSettings>(project.settings);
  useEffect(() => { setName(project.name); setColor(project.color); setKind(project.kind); setS(project.settings); }, [project]);
  const repos = useRepoRegistry();
  const workflows = useQuery({ queryKey: ['wf', 'list'], queryFn: () => api<{ id: string; name: string }[]>('/api/workflows') });
  const skills = useQuery({ queryKey: ['skills', 'list'], queryFn: () => api<{ path: string; name: string }[]>('/api/skills') });
  const save = useMutation({
    mutationFn: () => api<Project>(`/api/projects/${project.slug}`, { method: 'PUT', body: JSON.stringify({ name, color, kind, settings: s }) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['project', project.slug] }); qc.invalidateQueries({ queryKey: ['projects'] }); qc.invalidateQueries({ queryKey: ['tasks'] }); },
  });
  const remove = useMutation({
    mutationFn: () => api(`/api/projects/${project.slug}`, { method: 'DELETE' }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['projects'] }); navigate({ to: '/projects' }); },
  });
  const rules = s.rules;
  const setRules = (patch: Partial<ProjectSettings['rules']>) => setS({ ...s, rules: { ...rules, ...patch } });
  const varRows = Object.entries(s.vars);
  const missing = s.workplaceIds.filter(id => repos.data && !repos.data.workplaces.some(w => w.id === id));
  const wp = repos.data?.workplaces.find(w => w.id === s.workplaceIds[0]);
  const [suggestMsg, setSuggestMsg] = useState<{ text: string; isError?: boolean } | null>(null);
  const [suggesting, setSuggesting] = useState(false);

  const handleSuggest = async () => {
    if (!wp) return;
    setSuggesting(true);
    setSuggestMsg(null);
    try {
      const data = await api<RepoInspection>('/api/repos/inspect', {
        method: 'POST',
        body: JSON.stringify({ path: wp.path }),
      });
      if (data.suggestedVars && Object.keys(data.suggestedVars).length > 0) {
        const merged = { ...data.suggestedVars, ...s.vars };
        for (const [k, v] of Object.entries(data.suggestedVars)) {
          if (!merged[k]?.trim()) merged[k] = v;
        }
        setS({ ...s, vars: merged });
        setSuggestMsg({ text: 'Suggested settings filled from repo. Review and click Save below.' });
      } else {
        setSuggestMsg({ text: 'No stack detected to suggest variables from.', isError: true });
      }
    } catch (e) {
      setSuggestMsg({ text: `Inspection failed: ${(e as Error).message}`, isError: true });
    } finally {
      setSuggesting(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader><CardTitle>General</CardTitle></CardHeader>
        <CardContent className="grid gap-2 text-sm sm:grid-cols-3">
          <label className="flex flex-col gap-1 text-xs">Name<Input value={name} onChange={e => setName(e.target.value)} /></label>
          <label className="flex flex-col gap-1 text-xs">Color<Input type="color" value={color} onChange={e => setColor(e.target.value)} /></label>
          <label className="flex flex-col gap-1 text-xs">Kind
            <Select value={kind} onChange={e => setKind(e.target.value as Project['kind'])}><option value="personal">personal</option><option value="company">company</option></Select>
          </label>
          <label className="flex flex-col gap-1 text-xs">Key prefix of new tasks
            <Input placeholder="e.g. TX" value={s.keyPrefix ?? ''} onChange={e => setS({ ...s, keyPrefix: e.target.value.toUpperCase() || undefined })} />
          </label>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Which tasks belong here</CardTitle></CardHeader>
        <CardContent className="grid gap-2 text-sm sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-xs">Boards (Jira project keys)
            <Input placeholder="DEMO, WEB" value={rules.jiraKeys.join(', ')} onChange={e => setRules({ jiraKeys: list(e.target.value.toUpperCase()) })} />
          </label>
          <label className="flex flex-col gap-1 text-xs">Repositories (ids from the Repos page)
            <Input placeholder="tesserax" value={rules.repositories.join(', ')} onChange={e => setRules({ repositories: list(e.target.value) })} />
          </label>
          <p className="text-xs text-muted-foreground sm:col-span-2">A task joins the first project (in list order) that matches; a task you move by hand stays where you put it. One board or source can belong to one project only.</p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Workplaces, workflows and skills</CardTitle></CardHeader>
        <CardContent className="grid gap-4 text-sm md:grid-cols-3">
          <PickList
            title="Workplaces" hint="the first is the default" value={s.workplaceIds.length ? s.workplaceIds : null}
            options={(repos.data?.workplaces ?? []).map(w => ({ id: w.id, label: workplaceLabel(repos.data, w) }))}
            onChange={v => setS({ ...s, workplaceIds: v ?? [] })}
          />
          <PickList title="Workflows" hint="enabled here" value={s.workflows} options={(workflows.data ?? []).map(w => ({ id: w.id, label: w.name }))} onChange={v => setS({ ...s, workflows: v })} />
          <PickList title="Skills" hint="enabled here" value={s.skills} options={(skills.data ?? []).map(k => ({ id: k.path, label: k.name }))} onChange={v => setS({ ...s, skills: v })} />
          {missing.length > 0 && <p className="text-xs text-red-600 md:col-span-3">Workplaces removed from Repos: {missing.join(', ')}. New runs of this project will not start until you fix this.</p>}
          <p className="text-xs text-muted-foreground md:col-span-3">Which workflow a task starts is set on the Workflows page, for the project picked in the top bar.</p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Agent engines</CardTitle></CardHeader>
        <CardContent className="flex flex-col gap-2 text-sm">
          <PickList title="Allowed engines" hint="for AI steps of this project" value={s.engines.allowed} options={AI_ENGINES.map(e => ({ id: e, label: e }))} onChange={v => setS({ ...s, engines: { ...s.engines, allowed: v } })} />
          <label className="flex items-center gap-2 text-xs">Fallback when a step uses a disallowed engine
            <Select value={s.engines.default ?? ''} onChange={e => setS({ ...s, engines: { ...s.engines, default: e.target.value || null } })}>
              <option value="">none (the step fails)</option>
              {AI_ENGINES.map(e => <option key={e}>{e}</option>)}
            </Select>
          </label>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Variables</CardTitle>
          <Button
            size="sm"
            variant="outline"
            type="button"
            disabled={!wp || suggesting}
            title={!wp ? 'Assign a workplace first to detect settings' : undefined}
            onClick={handleSuggest}
          >
            {suggesting ? 'Suggesting...' : 'Suggest from repo'}
          </Button>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 text-sm">
          {suggestMsg && (
            <p className={`text-xs ${suggestMsg.isError ? 'text-destructive text-red-600' : 'text-emerald-600'}`}>
              {suggestMsg.text}
            </p>
          )}
          {varRows.map(([k, v]) => (
            <div key={k} className="flex items-center gap-2">
              <code className="w-40">{k}</code>
              <Input className="flex-1" value={v} onChange={e => setS({ ...s, vars: { ...s.vars, [k]: e.target.value } })} />
              <button className="rounded p-1 hover:bg-accent" title="Remove" onClick={() => setS({ ...s, vars: Object.fromEntries(varRows.filter(([x]) => x !== k)) })}><X className="size-3" /></button>
            </div>
          ))}
          <NewVar onAdd={(k, v) => setS({ ...s, vars: { ...s.vars, [k]: v } })} />
        </CardContent>
      </Card>
      <div className="flex items-center gap-2">
        <Button size="sm" disabled={save.isPending} onClick={() => save.mutate()}><Save className="size-3.5" />Save</Button>
        {!project.isDefault && (
          <Button size="sm" variant="outline" disabled={remove.isPending} onClick={() => confirm(`Delete "${project.name}"? Its tasks move to the default project.`) && remove.mutate()}><Trash2 className="size-3.5" />Delete</Button>
        )}
        {save.isSuccess && <span className="text-xs text-emerald-600">Saved.</span>}
        {(save.error || remove.error) && <span className="text-sm text-red-600">{String(((save.error ?? remove.error) as Error).message)}</span>}
      </div>
    </div>
  );
}

function NewVar({ onAdd }: { onAdd: (k: string, v: string) => void }) {
  const [k, setK] = useState('');
  const [v, setV] = useState('');
  const valid = /^[a-z][a-z0-9_]*$/.test(k);
  return (
    <div className="flex items-center gap-2">
      <Input className="w-40" placeholder="test_command" value={k} onChange={e => setK(e.target.value)} />
      <Input className="flex-1" placeholder="value" value={v} onChange={e => setV(e.target.value)} />
      <Button size="sm" variant="outline" disabled={!valid} onClick={() => { onAdd(k, v); setK(''); setV(''); }}><Plus className="size-3.5" />Add</Button>
    </div>
  );
}
