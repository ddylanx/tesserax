import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertCircle,
  Bookmark,
  Bug,
  Building2,
  CheckSquare,
  ExternalLink,
  Filter,
  Flame,
  FolderGit2,
  GitPullRequest,
  Laptop,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Pin,
  X,
} from 'lucide-react';
import { TaskDialog } from '@/components/task-dialog';
import { StartWorkflowDialog } from '@/components/workflow-picker';
import { Link } from '@tanstack/react-router';
import { useEffect, useMemo, useState } from 'react';
import type { TaskDetailDto, TaskDto, TaskList, TaskQuery, WorkflowRunList } from '@tesserax/contracts';
import { Page, QueryState } from '@/components/page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/input';
import { Table, TBody, Td, Th, THead, Tr } from '@/components/ui/table';
import { api } from '@/lib/api';
import { ProjectDot, useProjectScope } from '@/lib/project-context';
import { cn, timeAgo } from '@/lib/utils';

const STORAGE_KEY = 'tesserax:tasks-filter-v2';

const CAT = {
  in_progress: { label: 'In progress', variant: 'blue' as const },
  todo: { label: 'To do', variant: 'default' as const },
  done: { label: 'Done', variant: 'green' as const },
} as const;

function loadCachedFilters(): TaskQuery {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      return {
        q: typeof parsed.q === 'string' && parsed.q ? parsed.q : undefined,
        board: typeof parsed.board === 'string' && parsed.board ? parsed.board : undefined,
        source: typeof parsed.source === 'string' && parsed.source ? parsed.source : undefined,
        statusCategory: ['todo', 'in_progress', 'done'].includes(parsed.statusCategory) ? parsed.statusCategory : undefined,
        includeArchived: parsed.includeArchived === '1' ? '1' : undefined,
        includeDone: parsed.includeDone === '1' ? '1' : undefined,
      };
    }
  } catch {
    /* ignore corrupted json */
  }
  return {};
}

function renderTypeBadge(type: string | null) {
  if (!type) return null;
  const t = type.toLowerCase();
  if (t === 'bug') {
    return (
      <Badge variant="red" className="text-[10px] font-medium gap-1 px-1.5 py-0">
        <Bug className="size-2.5" /> Bug
      </Badge>
    );
  }
  if (t === 'story') {
    return (
      <Badge variant="green" className="text-[10px] font-medium gap-1 px-1.5 py-0">
        <Bookmark className="size-2.5" /> Story
      </Badge>
    );
  }
  if (t === 'code review') {
    return (
      <Badge variant="purple" className="text-[10px] font-medium gap-1 px-1.5 py-0">
        <GitPullRequest className="size-2.5" /> Review
      </Badge>
    );
  }
  return (
    <Badge variant="slate" className="text-[10px] font-medium gap-1 px-1.5 py-0">
      <CheckSquare className="size-2.5" /> {type}
    </Badge>
  );
}

function renderPriorityBadge(priority: string | null) {
  if (!priority) return <span className="text-xs text-muted-foreground">–</span>;
  const p = priority.toLowerCase();
  if (p.includes('high') || p.includes('crit') || p.includes('block')) {
    return (
      <Badge variant="red" className="text-[11px] font-semibold gap-1 px-1.5 py-0.5">
        <Flame className="size-3 text-rose-500" />
        {priority}
      </Badge>
    );
  }
  if (p.includes('med')) {
    return (
      <Badge variant="amber" className="text-[11px] font-medium gap-1 px-1.5 py-0.5">
        <AlertCircle className="size-3 text-amber-500" />
        {priority}
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="text-[11px] text-muted-foreground px-1.5 py-0.5">
      {priority}
    </Badge>
  );
}

function renderStatusBadge(statusCategory: 'todo' | 'in_progress' | 'done', statusName: string | null) {
  if (statusCategory === 'in_progress') {
    return (
      <Badge variant="blue" className="font-semibold gap-1.5 text-xs py-0.5">
        <span className="size-1.5 rounded-full bg-sky-500 animate-pulse" />
        {statusName ?? 'In progress'}
      </Badge>
    );
  }
  if (statusCategory === 'done') {
    return (
      <Badge variant="green" className="font-semibold gap-1.5 text-xs py-0.5">
        <span className="size-1.5 rounded-full bg-emerald-500" />
        {statusName ?? 'Done'}
      </Badge>
    );
  }
  return (
    <Badge variant="default" className="font-medium gap-1.5 text-xs py-0.5">
      <span className="size-1.5 rounded-full bg-muted-foreground/60" />
      {statusName ?? 'To do'}
    </Badge>
  );
}

export function TasksPage() {
  const [f, setF] = useState<TaskQuery>(loadCachedFilters);
  const set = (k: keyof TaskQuery) => (v: string) => setF(prev => ({ ...prev, [k]: v || undefined }));

  // Cache filter preferences into localStorage
  useEffect(() => {
    try {
      const cleaned = Object.fromEntries(Object.entries(f).filter(([, v]) => v != null && v !== ''));
      if (Object.keys(cleaned).length > 0) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(cleaned));
      } else {
        localStorage.removeItem(STORAGE_KEY);
      }
    } catch {
      /* ignore storage quota/security issues */
    }
  }, [f]);

  const clearFilters = () => {
    setF({});
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {}
  };

  const { selected: project, projects } = useProjectScope();
  const params = new URLSearchParams(Object.entries({ ...f, project }).filter(([, v]) => v) as [string, string][]);
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['tasks', f, project], queryFn: () => api<TaskList>(`/api/tasks?${params}`), refetchInterval: 30_000 });
  const sourceKinds = useMemo(() => {
    const list: { kind: string; label: string; icon: typeof Building2; activeClass: string }[] = [];
    const available = new Set<string>();
    for (const s of q.data?.sources ?? []) {
      if (s.kind) available.add(s.kind);
    }
    if (q.data?.jiraConfigured || available.has('jira')) {
      list.push({ kind: 'jira', label: 'Office (Jira)', icon: Building2, activeClass: 'bg-sky-500/15 text-sky-700 dark:text-sky-300' });
    }
    if (q.data?.githubConfigured || available.has('github')) {
      list.push({ kind: 'github', label: 'GitHub', icon: FolderGit2, activeClass: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300' });
    }
    for (const k of available) {
      if (k !== 'jira' && k !== 'github' && k !== 'local') {
        list.push({ kind: k, label: k, icon: FolderGit2, activeClass: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300' });
      }
    }
    list.push({ kind: 'local', label: 'Local', icon: Laptop, activeClass: 'bg-purple-500/15 text-purple-700 dark:text-purple-300' });
    return list;
  }, [q.data]);
  const sync = useMutation({
    mutationFn: () => api<{ queued: boolean }>('/api/tasks/sync', { method: 'POST' }),
    onSuccess: () => setTimeout(() => qc.invalidateQueries({ queryKey: ['tasks'] }), 4000),
  });
  const move = useMutation({
    mutationFn: ({ id, projectId }: { id: string; projectId: string | null }) => api(`/api/tasks/${id}/project`, { method: 'PATCH', body: JSON.stringify({ projectId }) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tasks'] });
      qc.invalidateQueries({ queryKey: ['projects'] });
    },
  });
  const [starting, setStarting] = useState<TaskDto | null>(null);
  const runsQ = useQuery({ queryKey: ['wf', 'runs', 'all'], queryFn: () => api<WorkflowRunList>('/api/workflow-runs?status=all'), refetchInterval: 15_000 });
  const activeRun = new Map((runsQ.data?.runs ?? []).filter(r => ['running', 'waiting', 'failed'].includes(r.status)).map(r => [r.task.id, r]));
  const [dialog, setDialog] = useState<{ task?: TaskDetailDto } | null>(null);
  const openEdit = (id: string) => api<TaskDetailDto>(`/api/tasks/${id}`).then(task => setDialog({ task }));
  const d = q.data;
  const tasks = d?.tasks ?? [];

  const activeFilterCount = [
    f.q,
    f.source,
    f.board,
    f.statusCategory,
    f.includeArchived === '1' ? 'archived' : undefined,
  ].filter(Boolean).length;

  return (
    <Page
      title="Tasks"
      description={
        d?.sources.length
          ? d.sources.map(s => (
              <span key={s.id} className="mr-3">
                {s.kind} · {s.name} ({s.projectSlug}): {s.taskCount} open, synced {timeAgo(s.lastSyncedAt)}
                {s.lastError && <span className="text-red-600"> · last error: {s.lastError}</span>}
              </span>
            ))
          : 'Read-only tasks from Jira Cloud.'
      }
      actions={
        <div className="flex gap-2">
          <Button size="sm" onClick={() => setDialog({})}>
            <Plus className="size-3.5" />New task
          </Button>
          <Button variant="outline" size="sm" disabled={!d?.jiraConfigured || sync.isPending} onClick={() => sync.mutate()}>
            <RefreshCw className={`size-3.5 ${sync.isPending ? 'animate-spin' : ''}`} />Sync now
          </Button>
        </div>
      }
    >
      {d && !d.jiraConfigured && (
        <Card>
          <CardContent className="pt-4 text-sm">
            Jira is not connected. Set <code>JIRA_BASE_URL</code> (e.g. https://your-site.atlassian.net), <code>JIRA_EMAIL</code> and <code>JIRA_API_TOKEN</code> in <code>tesserax/.env</code>, then restart <code>pnpm dev</code>. Tasks sync every ~2 minutes.
          </CardContent>
        </Card>
      )}

      {/* Filter toolbar */}
      <div className="flex flex-col gap-2.5 rounded-lg border bg-card/60 p-3 shadow-2xs">
        <div className="flex flex-wrap items-center justify-between gap-2.5">
          <div className="flex flex-wrap items-center gap-2 flex-1">
            {/* Search Input */}
            <div className="relative min-w-[200px] max-w-xs flex-1">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
              <Input
                placeholder="Search title, key, assignee…"
                className="pl-8 pr-7 h-8 text-xs"
                value={f.q ?? ''}
                onChange={e => set('q')(e.target.value)}
              />
              {f.q && (
                <button
                  type="button"
                  onClick={() => set('q')('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded-full hover:bg-muted text-muted-foreground cursor-pointer"
                  title="Clear search"
                >
                  <X className="size-3" />
                </button>
              )}
            </div>

            {/* Source Segmented Control */}
            <div className="flex items-center rounded-md border bg-muted/50 p-0.5 text-xs">
              <button
                type="button"
                onClick={() => set('source')('')}
                className={cn(
                  'flex items-center gap-1 rounded px-2.5 py-1 font-medium transition-all cursor-pointer',
                  !f.source ? 'bg-background shadow-2xs text-foreground font-semibold' : 'text-muted-foreground hover:text-foreground'
                )}
              >
                All Sources
              </button>
              {sourceKinds.map(s => {
                const Icon = s.icon;
                return (
                  <button
                    key={s.kind}
                    type="button"
                    onClick={() => set('source')(s.kind)}
                    className={cn(
                      'flex items-center gap-1.5 rounded px-2.5 py-1 font-medium transition-all cursor-pointer',
                      f.source === s.kind ? `${s.activeClass} shadow-2xs font-semibold` : 'text-muted-foreground hover:text-foreground'
                    )}
                  >
                    <Icon className="size-3.5" />
                    {s.label}
                  </button>
                );
              })}
            </div>

            {/* Project Filter */}
            <Select
              value={f.board ?? ''}
              onChange={e => set('board')(e.target.value)}
              title="Jira board (project key)"
              className={cn(
                'h-8 text-xs font-medium cursor-pointer transition-colors',
                f.board ? 'border-primary/50 bg-primary/5 text-primary font-semibold' : ''
              )}
            >
              <option value="">📁 All boards ({d?.boards.length ?? 0})</option>
              {d?.boards.map(p => (
                <option key={p} value={p}>
                  📁 {p}
                </option>
              ))}
            </Select>

            {/* Status Category Filter */}
            <Select
              value={f.statusCategory ?? ''}
              onChange={e => set('statusCategory')(e.target.value)}
              className={cn(
                'h-8 text-xs font-medium cursor-pointer transition-colors',
                f.statusCategory ? 'border-primary/50 bg-primary/5 text-primary font-semibold' : ''
              )}
            >
              <option value="">Status: Open (To do + In progress)</option>
              <option value="in_progress">🔵 In progress</option>
              <option value="todo">⚪ To do</option>
              <option value="done">✅ Done</option>
            </Select>

            {/* Show archived Toggle */}
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground cursor-pointer select-none px-1">
              <input
                type="checkbox"
                checked={f.includeArchived === '1'}
                onChange={e => set('includeArchived')(e.target.checked ? '1' : '')}
                className="rounded border-border accent-primary cursor-pointer size-3.5"
              />
              Show archived
            </label>
          </div>

          {/* Reset Filters button */}
          {activeFilterCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={clearFilters}
              className="h-8 text-xs text-muted-foreground hover:text-destructive gap-1 px-2.5"
              title="Reset all filters"
            >
              <RotateCcw className="size-3" />
              Reset filters ({activeFilterCount})
            </Button>
          )}
        </div>

        {/* Active filter badges row */}
        {activeFilterCount > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 pt-1 border-t border-border/40 text-xs">
            <span className="text-[11px] text-muted-foreground font-medium flex items-center gap-1 mr-1">
              <Filter className="size-3" /> Active:
            </span>
            {f.source && (
              <span className="inline-flex items-center gap-1 rounded-full border bg-background px-2.5 py-0.5 text-[11px] font-medium shadow-2xs">
                Source: <span className="font-semibold text-foreground">{f.source === 'jira' ? 'Office (Jira)' : 'Local'}</span>
                <button type="button" onClick={() => set('source')('')} className="ml-0.5 hover:text-destructive cursor-pointer">
                  <X className="size-3" />
                </button>
              </span>
            )}
            {f.project && (
              <span className="inline-flex items-center gap-1 rounded-full border bg-background px-2.5 py-0.5 text-[11px] font-medium shadow-2xs">
                Project: <span className="font-semibold text-foreground">{f.project}</span>
                <button type="button" onClick={() => set('project')('')} className="ml-0.5 hover:text-destructive cursor-pointer">
                  <X className="size-3" />
                </button>
              </span>
            )}
            {f.statusCategory && (
              <span className="inline-flex items-center gap-1 rounded-full border bg-background px-2.5 py-0.5 text-[11px] font-medium shadow-2xs">
                Status: <span className="font-semibold text-foreground">{CAT[f.statusCategory]?.label ?? f.statusCategory}</span>
                <button type="button" onClick={() => set('statusCategory')('')} className="ml-0.5 hover:text-destructive cursor-pointer">
                  <X className="size-3" />
                </button>
              </span>
            )}
            {f.board && (
              <span className="inline-flex items-center gap-1 rounded-full border bg-background px-2.5 py-0.5 text-[11px] font-medium shadow-2xs">
                Board: <span className="font-semibold text-foreground">{f.board}</span>
                <button type="button" onClick={() => set('board')('')} className="ml-0.5 hover:text-destructive cursor-pointer">
                  <X className="size-3" />
                </button>
              </span>
            )}
            {f.includeArchived === '1' && (
              <span className="inline-flex items-center gap-1 rounded-full border bg-background px-2.5 py-0.5 text-[11px] font-medium shadow-2xs">
                <span className="font-semibold text-foreground">Archived included</span>
                <button type="button" onClick={() => set('includeArchived')('')} className="ml-0.5 hover:text-destructive cursor-pointer">
                  <X className="size-3" />
                </button>
              </span>
            )}
            {f.q && (
              <span className="inline-flex items-center gap-1 rounded-full border bg-background px-2.5 py-0.5 text-[11px] font-medium shadow-2xs">
                Keyword: <span className="font-semibold font-mono text-foreground">"{f.q}"</span>
                <button type="button" onClick={() => set('q')('')} className="ml-0.5 hover:text-destructive cursor-pointer">
                  <X className="size-3" />
                </button>
              </span>
            )}
          </div>
        )}
      </div>

      {/* Task table card */}
      <Card>
        <QueryState isLoading={q.isLoading} error={q.error} empty={!q.isLoading && tasks.length === 0} emptyText={activeFilterCount > 0 ? 'No tasks match current filters.' : 'No tasks found.'} />
        {tasks.length > 0 && (
          <Table>
            <THead>
              <Tr>
                <Th className="w-[140px]">Key & Source</Th>
                <Th>Task</Th>
                <Th className="w-[140px]">Status</Th>
                <Th className="w-[100px]">Priority</Th>
                <Th className="w-[130px]">Assignee</Th>
                <Th className="w-[110px]">Due</Th>
                <Th className="w-[100px]">Updated</Th>
                <Th className="w-[130px] text-right">Actions</Th>
              </Tr>
            </THead>
            <TBody>
              {tasks.map(t => (
                <Tr key={t.id} className={cn('transition-colors hover:bg-muted/30', t.archived ? 'opacity-60 bg-muted/10' : '')}>
                  {/* Key & Source Column */}
                  <Td className="whitespace-nowrap align-top">
                    <div className="flex flex-col gap-1 items-start">
                      {t.url ? (
                        <a
                          className="inline-flex items-center gap-1 font-mono font-medium text-sky-600 dark:text-sky-400 hover:underline"
                          href={t.url}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {t.source === 'github' ? `${t.project ?? ''}${t.key ?? ''}` : (t.key ?? '–')}
                          <ExternalLink className="size-3 opacity-70" />
                        </a>
                      ) : (
                        <span className="font-mono font-medium">{t.source === 'github' ? `${t.project ?? ''}${t.key ?? ''}` : (t.key ?? '–')}</span>
                      )}
                      <div className="flex flex-wrap gap-1">
                        {t.source === 'jira' ? (
                          <Badge variant="blue" className="text-[10px] font-semibold gap-1 px-1.5 py-0">
                            <Building2 className="size-2.5" /> Office
                          </Badge>
                        ) : t.source === 'github' ? (
                          <Badge variant="green" className="text-[10px] font-semibold gap-1 px-1.5 py-0">
                            <FolderGit2 className="size-2.5" /> GitHub
                          </Badge>
                        ) : (
                          <Badge variant="purple" className="text-[10px] font-semibold gap-1 px-1.5 py-0">
                            <Laptop className="size-2.5" /> Local
                          </Badge>
                        )}
                        {!project && (
                          <Badge variant="outline" className="text-[10px] gap-1 px-1.5 py-0 text-muted-foreground">
                            <ProjectDot color={t.projectColor} name={t.projectSlug} />
                            {t.projectSlug}
                            {t.pinned && <Pin className="size-2.5" />}
                          </Badge>
                        )}
                      </div>
                    </div>
                  </Td>

                  {/* Title & Metadata Badges Column */}
                  <Td className="align-top">
                    <div>
                      <span className="font-medium text-foreground">{t.title}</span>
                      {t.archived && (
                        <Badge variant="outline" className="ml-2 text-[10px] text-amber-600 border-amber-500/30 bg-amber-500/5">
                          archived
                        </Badge>
                      )}
                    </div>
                    {/* Metadata Badges: Type, Project, Labels */}
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      {renderTypeBadge(t.type)}
                      {t.project && (
                        <Badge variant="slate" title="Board (Jira project key)" className="font-mono text-[10px] font-semibold tracking-wide gap-1 px-1.5 py-0">
                          <FolderGit2 className="size-2.5 text-muted-foreground" />
                          {t.project}
                        </Badge>
                      )}
                      {t.labels.map(l => (
                        <span
                          key={l}
                          className="inline-flex items-center px-1.5 py-0 rounded text-[10px] font-mono bg-muted text-muted-foreground border border-border/40"
                        >
                          #{l}
                        </span>
                      ))}
                    </div>
                    {activeRun.get(t.id) && (
                      <Link
                        to="/runs/$runId"
                        params={{ runId: activeRun.get(t.id)!.id }}
                        className="mt-1.5 inline-flex items-center gap-1.5 rounded-md border border-sky-500/30 bg-sky-500/10 px-2 py-0.5 text-xs font-medium text-sky-700 hover:bg-sky-500/20 dark:text-sky-300 transition-colors"
                      >
                        <span className="size-1.5 rounded-full bg-sky-500 animate-ping" />
                        run: <span className="font-semibold">{activeRun.get(t.id)!.workflowId}</span> · {activeRun.get(t.id)!.status}
                        {activeRun.get(t.id)!.currentNodeLabel ? ` · ${activeRun.get(t.id)!.currentNodeLabel}` : ''} →
                      </Link>
                    )}
                  </Td>

                  {/* Status Badge Column */}
                  <Td className="align-top whitespace-nowrap">
                    {renderStatusBadge(t.statusCategory, t.status)}
                  </Td>

                  {/* Priority Badge Column */}
                  <Td className="align-top whitespace-nowrap">
                    {renderPriorityBadge(t.priority)}
                  </Td>

                  {/* Assignee Column */}
                  <Td className="text-xs whitespace-nowrap align-top text-muted-foreground">
                    {t.assignee ? (
                      <span className="text-foreground font-medium">{t.assignee}</span>
                    ) : (
                      <span className="italic opacity-70">Unassigned</span>
                    )}
                  </Td>

                  {/* Due Date Column */}
                  <Td className="text-xs whitespace-nowrap align-top text-muted-foreground">
                    {t.dueAt ?? '–'}
                  </Td>

                  {/* Updated Time Column */}
                  <Td className="text-xs whitespace-nowrap align-top text-muted-foreground">
                    {timeAgo(t.updatedAt)}
                  </Td>

                  {/* Actions Column */}
                  <Td className="align-top text-right">
                    <div className="flex justify-end gap-1.5">
                      {t.source === 'local' && (
                        <Button size="sm" variant="ghost" title="Edit local task" onClick={() => openEdit(t.id)}>
                          <Pencil className="size-3" />
                        </Button>
                      )}
                      <Select
                        className="h-7 w-24 text-[11px]"
                        title="Move to project"
                        value={projects.find(p => p.slug === t.projectSlug)?.id ?? ''}
                        onChange={e => move.mutate({ id: t.id, projectId: e.target.value || null })}
                      >
                        {t.pinned && <option value="">↺ by rules</option>}
                        {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                      </Select>
                      <Button size="sm" variant="outline" title="Choose a workflow and start it" onClick={() => setStarting(t)}>
                        <Play className="size-3" />Start
                      </Button>
                    </div>
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </Card>

      {dialog && <TaskDialog task={dialog.task} onClose={() => setDialog(null)} />}
      {starting && <StartWorkflowDialog task={starting} onClose={() => setStarting(null)} />}
    </Page>
  );
}
