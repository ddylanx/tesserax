import { type InfiniteData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Building2,
  ChevronDown,
  Columns3,
  ExternalLink,
  Filter,
  FolderGit2,
  Laptop,
  List,
  Lock,
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
import {
  activeRun,
  latestRunByTask,
  type DroppableColumn,
  type TaskDetailDto,
  type TaskDto,
  type TaskList,
  type TaskQuery,
  type WorkflowRunList,
} from '@tesserax/contracts';
import { Page, QueryState } from '@/components/page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/input';
import { Table, TBody, Td, Th, THead, Tr } from '@/components/ui/table';
import { api, ApiError } from '@/lib/api';
import { ProjectDot, useProjectScope } from '@/lib/project-context';
import { cn, timeAgo } from '@/lib/utils';
import { TaskBoard } from '@/components/task-board';
import { renderPriorityBadge, renderTypeBadge } from '@/components/task-badges';

const STORAGE_KEY = 'tesserax:tasks-filter-v2';
const VIEW_STORAGE_KEY = 'tesserax:tasks-view';

function loadCachedView(): 'list' | 'board' {
  if (typeof window === 'undefined') return 'list';
  try {
    const raw = localStorage.getItem(VIEW_STORAGE_KEY);
    if (raw === 'board' || raw === 'list') return raw;
  } catch {
    /* ignore storage issues */
  }
  return 'list';
}

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

function renderStatusBadge(statusCategory: 'todo' | 'in_progress' | 'done', statusName: string | null) {
  if (statusCategory === 'in_progress') {
    return (
      <Badge variant="blue" className="font-semibold gap-1.5 text-xs py-0.5">
        <span className="size-1.5 rounded-full bg-info animate-pulse" />
        {statusName ?? 'In progress'}
      </Badge>
    );
  }
  if (statusCategory === 'done') {
    return (
      <Badge variant="green" className="font-semibold gap-1.5 text-xs py-0.5">
        <span className="size-1.5 rounded-full bg-success" />
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
  const [view, setView] = useState<'list' | 'board'>(loadCachedView);

  useEffect(() => {
    try {
      localStorage.setItem(VIEW_STORAGE_KEY, view);
    } catch {}
  }, [view]);

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
  const qc = useQueryClient();

  // List view query
  const params = new URLSearchParams(Object.entries({ ...f, project }).filter(([, v]) => v) as [string, string][]);
  const q = useQuery({
    queryKey: ['tasks', f, project],
    queryFn: () => api<TaskList>(`/api/tasks?${params}`),
    refetchInterval: 30_000,
    enabled: view === 'list',
  });

  // Board view queries
  const { statusCategory: _sc, includeDone: _id, ...boardFilters } = f;
  const boardOpenParams = new URLSearchParams(
    Object.entries({ ...boardFilters, project }).filter(([, v]) => v) as [string, string][],
  );
  const boardOpenQ = useQuery({
    queryKey: ['tasks', 'board-open', boardFilters, project],
    queryFn: () => api<TaskList>(`/api/tasks?${boardOpenParams}`),
    refetchInterval: 30_000,
    enabled: view === 'board',
  });

  const [doneUpdatedSince] = useState(() => new Date(Date.now() - 14 * 864e5).toISOString());
  const boardDoneQ = useInfiniteQuery({
    queryKey: ['tasks', 'board-done', boardFilters, project],
    queryFn: ({ pageParam }) => {
      const p = new URLSearchParams(
        Object.entries({
          ...boardFilters,
          project,
          statusCategory: 'done',
          updatedSince: doneUpdatedSince,
          limit: '50',
          cursor: pageParam ?? undefined,
        }).filter(([, v]) => v) as [string, string][],
      );
      return api<TaskList>(`/api/tasks?${p}`);
    },
    initialPageParam: null as string | null,
    getNextPageParam: last => last.nextCursor ?? undefined,
    refetchInterval: 30_000,
    enabled: view === 'board',
  });

  const boardTasks = useMemo(() => {
    const openTasks = boardOpenQ.data?.tasks ?? [];
    const doneTasks = boardDoneQ.data?.pages.flatMap(p => p.tasks) ?? [];
    const seen = new Set<string>();
    const combined: TaskDto[] = [];
    for (const t of openTasks) {
      if (!seen.has(t.id)) {
        seen.add(t.id);
        combined.push(t);
      }
    }
    for (const t of doneTasks) {
      if (!seen.has(t.id)) {
        seen.add(t.id);
        combined.push(t);
      }
    }
    return combined;
  }, [boardOpenQ.data?.tasks, boardDoneQ.data?.pages]);

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
  const updateStatus = useMutation({
    mutationFn: ({ id, statusCategory }: { id: string; statusCategory: 'todo' | 'in_progress' | 'done' }) =>
      api<TaskDetailDto>(`/api/tasks/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ statusCategory }),
      }),
    onMutate: async ({ id, statusCategory }) => {
      await qc.cancelQueries({ queryKey: ['tasks'] });
      const prev = qc.getQueryData<TaskList>(['tasks', f, project]);
      if (prev) {
        const statusNames = { todo: 'To Do', in_progress: 'In Progress', done: 'Done' } as const;
        qc.setQueryData<TaskList>(['tasks', f, project], {
          ...prev,
          tasks: prev.tasks.map(task =>
            task.id === id ? { ...task, statusCategory, status: statusNames[statusCategory] } : task
          ),
        });
      }
      return { prev };
    },
    onError: (_err, _vars, context) => {
      if (context?.prev) {
        qc.setQueryData(['tasks', f, project], context.prev);
      }
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['tasks'] });
    },
  });

  const [boardError, setBoardError] = useState<string | null>(null);
  const moveBoardTask = useMutation({
    mutationFn: async ({ id, statusCategory }: { id: string; statusCategory: DroppableColumn; task?: TaskDto }) => {
      try {
        return await api<TaskDetailDto>(`/api/tasks/${id}/status`, {
          method: 'PATCH',
          body: JSON.stringify({ statusCategory }),
        });
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) {
          return await api<TaskDetailDto>(`/api/tasks/${id}`, {
            method: 'PATCH',
            body: JSON.stringify({ statusCategory }),
          });
        }
        throw err;
      }
    },
    onMutate: async ({ id, statusCategory, task }) => {
      setBoardError(null);
      await qc.cancelQueries({ queryKey: ['tasks'] });

      const openKey = ['tasks', 'board-open', boardFilters, project];
      const doneKey = ['tasks', 'board-done', boardFilters, project];

      const prevOpen = qc.getQueryData<TaskList>(openKey);
      const prevDone = qc.getQueryData<InfiniteData<TaskList, string | null>>(doneKey);

      let foundTask = task ?? prevOpen?.tasks.find(t => t.id === id);
      if (!foundTask && prevDone) {
        for (const page of prevDone.pages) {
          const t = page.tasks.find(x => x.id === id);
          if (t) {
            foundTask = t;
            break;
          }
        }
      }

      if (foundTask) {
        const statusLabels: Record<DroppableColumn, string> = {
          todo: 'To Do',
          in_progress: 'In Progress',
          done: 'Done',
        };
        const nowIso = new Date().toISOString();

        if (statusCategory === 'todo' || statusCategory === 'in_progress') {
          const updatedTask: TaskDto = {
            ...foundTask,
            statusCategory,
            status: statusLabels[statusCategory],
            updatedAt: nowIso,
          };

          if (prevDone) {
            qc.setQueryData<InfiniteData<TaskList, string | null>>(doneKey, {
              ...prevDone,
              pages: prevDone.pages.map(p => ({
                ...p,
                tasks: p.tasks.filter(t => t.id !== id),
              })),
            });
          }

          if (prevOpen) {
            const exists = prevOpen.tasks.some(t => t.id === id);
            qc.setQueryData<TaskList>(openKey, {
              ...prevOpen,
              tasks: exists
                ? prevOpen.tasks.map(t => (t.id === id ? updatedTask : t))
                : [updatedTask, ...prevOpen.tasks],
            });
          }
        } else if (statusCategory === 'done') {
          const updatedTask: TaskDto = {
            ...foundTask,
            statusCategory: 'done',
            status: 'Done',
            updatedAt: nowIso,
          };

          if (prevOpen) {
            qc.setQueryData<TaskList>(openKey, {
              ...prevOpen,
              tasks: prevOpen.tasks.filter(t => t.id !== id),
            });
          }

          if (prevDone && prevDone.pages.length > 0) {
            qc.setQueryData<InfiniteData<TaskList, string | null>>(doneKey, {
              ...prevDone,
              pages: prevDone.pages.map((p, idx) =>
                idx === 0
                  ? { ...p, tasks: [updatedTask, ...p.tasks.filter(t => t.id !== id)] }
                  : { ...p, tasks: p.tasks.filter(t => t.id !== id) },
              ),
            });
          }
        }
      }

      return { prevOpen, prevDone, openKey, doneKey };
    },
    onError: (err, _vars, context) => {
      if (context) {
        if (context.prevOpen) qc.setQueryData(context.openKey, context.prevOpen);
        if (context.prevDone) qc.setQueryData(context.doneKey, context.prevDone);
      }
      setBoardError((err as Error).message);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['tasks'] });
    },
  });

  const [starting, setStarting] = useState<TaskDto | null>(null);
  const runsQ = useQuery({ queryKey: ['wf', 'runs', 'all'], queryFn: () => api<WorkflowRunList>('/api/workflow-runs?status=all'), refetchInterval: 15_000 });
  const latestRuns = useMemo(() => latestRunByTask(runsQ.data?.runs ?? []), [runsQ.data]);
  const [dialog, setDialog] = useState<{ task?: TaskDetailDto } | null>(null);
  const openEdit = (id: string) => api<TaskDetailDto>(`/api/tasks/${id}`).then(task => setDialog({ task }));

  const handleOpenTask = (task: TaskDto) => {
    if (task.source === 'local') {
      openEdit(task.id);
    } else if (task.url) {
      window.open(task.url, '_blank', 'noopener');
    }
  };

  const d = view === 'list' ? q.data : boardOpenQ.data;
  const tasks = d?.tasks ?? [];

  const activeFilterCount = [
    f.q,
    f.source,
    f.board,
    view === 'list' ? f.statusCategory : undefined,
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
                {s.lastError && <span className="text-destructive"> · last error: {s.lastError}</span>}
              </span>
            ))
          : 'Read-only tasks from Jira Cloud.'
      }
      actions={
        <div className="flex gap-2">
          <div className="flex items-center gap-1 border-r border-border pr-2">
            <Button
              size="sm"
              variant={view === 'list' ? 'default' : 'outline'}
              onClick={() => setView('list')}
              title="List view"
            >
              <List className="size-3.5" />List
            </Button>
            <Button
              size="sm"
              variant={view === 'board' ? 'default' : 'outline'}
              onClick={() => setView('board')}
              title="Board view"
            >
              <Columns3 className="size-3.5" />Board
            </Button>
          </div>
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

            {/* Source Segmented Control (Office vs Local) */}
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
              <button
                type="button"
                onClick={() => set('source')('jira')}
                className={cn(
                  'flex items-center gap-1.5 rounded px-2.5 py-1 font-medium transition-all cursor-pointer',
                  f.source === 'jira' ? 'bg-info/15 text-info shadow-2xs font-semibold' : 'text-muted-foreground hover:text-foreground'
                )}
              >
                <Building2 className="size-3.5 text-info" />
                Office (Jira)
              </button>
              <button
                type="button"
                onClick={() => set('source')('local')}
                className={cn(
                  'flex items-center gap-1.5 rounded px-2.5 py-1 font-medium transition-all cursor-pointer',
                  f.source === 'local' ? 'bg-purple-500/15 text-purple-700 dark:text-purple-300 shadow-2xs font-semibold' : 'text-muted-foreground hover:text-foreground'
                )}
              >
                <Laptop className="size-3.5 text-purple-600 dark:text-purple-400" />
                Local
              </button>
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

            {/* Status Category Filter - List view only */}
            {view === 'list' && (
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
            )}

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
            {view === 'list' && f.statusCategory && (
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

      {/* Board or List view */}
      {view === 'board' ? (
        <>
          <QueryState isLoading={boardOpenQ.isLoading} error={boardOpenQ.error} />
          {!boardOpenQ.isLoading && !boardOpenQ.error && (
            <TaskBoard
              tasks={boardTasks}
              runs={latestRuns}
              showProjectDot={!project}
              doneHasMore={Boolean(boardDoneQ.hasNextPage)}
              doneLoadingMore={boardDoneQ.isFetchingNextPage}
              onLoadMoreDone={() => boardDoneQ.fetchNextPage()}
              onMove={(task, to) => moveBoardTask.mutate({ id: task.id, statusCategory: to, task })}
              onOpen={handleOpenTask}
              error={boardError}
              onDismissError={() => setBoardError(null)}
            />
          )}
        </>
      ) : (
        <Card>
          <QueryState isLoading={q.isLoading} error={q.error} empty={!q.isLoading && tasks.length === 0} emptyText={activeFilterCount > 0 ? 'No tasks match current filters.' : 'No tasks found.'} />
          {tasks.length > 0 && (
            <Table>
            <THead>
              <Tr>
                <Th className="w-[140px]">Key & Source</Th>
                <Th>Task</Th>
                <Th className="w-[150px]">Status</Th>
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
                          className="inline-flex items-center gap-1 font-mono font-medium text-info hover:underline"
                          href={t.url}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {t.key ?? '–'}
                          <ExternalLink className="size-3 opacity-70" />
                        </a>
                      ) : (
                        <span className="font-mono font-medium">{t.key ?? '–'}</span>
                      )}
                      <div className="flex flex-wrap gap-1">
                        {t.source === 'jira' ? (
                          <Badge variant="blue" className="text-[10px] font-semibold gap-1 px-1.5 py-0">
                            <Building2 className="size-2.5" /> Office
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
                        <Badge variant="outline" className="ml-2 text-[10px] text-warning border-warning/30 bg-warning/5">
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
                    {(() => {
                      const r = activeRun(latestRuns.get(t.id));
                      if (!r) return null;
                      return (
                        <Link
                          to="/runs/$runId"
                          params={{ runId: r.id }}
                          className="mt-1.5 inline-flex items-center gap-1.5 rounded-md border border-info/30 bg-info/10 px-2 py-0.5 text-xs font-medium text-info hover:bg-info/20 transition-colors"
                        >
                          <span className="size-1.5 rounded-full bg-info animate-ping" />
                          run: <span className="font-semibold">{r.workflowId}</span> · {r.status}
                          {r.currentNodeLabel ? ` · ${r.currentNodeLabel}` : ''} →
                        </Link>
                      );
                    })()}
                  </Td>

                  {/* Status Column */}
                  <Td className="align-top whitespace-nowrap">
                    {t.source === 'local' ? (
                      <div className="flex flex-col items-start gap-1">
                        <div className="relative inline-flex items-center">
                          <select
                            value={t.statusCategory}
                            disabled={updateStatus.isPending && updateStatus.variables?.id === t.id}
                            onChange={e => updateStatus.mutate({ id: t.id, statusCategory: e.target.value as 'todo' | 'in_progress' | 'done' })}
                            className={cn(
                              'appearance-none cursor-pointer rounded-md border text-xs font-semibold py-0.5 pl-5 pr-5 outline-none transition-colors shadow-2xs',
                              t.statusCategory === 'in_progress' && 'border-info/30 bg-info/10 text-info hover:bg-info/20',
                              t.statusCategory === 'done' && 'border-success/30 bg-success/10 text-success hover:bg-success/20',
                              t.statusCategory === 'todo' && 'border-border bg-muted/70 text-foreground hover:bg-muted'
                            )}
                            title="Click to update local task status"
                          >
                            <option value="todo">To Do</option>
                            <option value="in_progress">In Progress</option>
                            <option value="done">Done</option>
                          </select>
                          <span
                            className={cn(
                              'pointer-events-none absolute left-2 size-1.5 rounded-full',
                              t.statusCategory === 'in_progress' && 'bg-info animate-pulse',
                              t.statusCategory === 'done' && 'bg-success',
                              t.statusCategory === 'todo' && 'bg-muted-foreground/60'
                            )}
                          />
                          <ChevronDown className="pointer-events-none absolute right-1.5 size-3 opacity-60" />
                        </div>
                        <span className="text-[10px] text-purple-600 dark:text-purple-400 font-medium">Local status</span>
                      </div>
                    ) : (
                      <div className="flex flex-col items-start gap-1">
                        <div className="inline-flex items-center gap-1.5" title="Synced from Jira Cloud (Read-only)">
                          {renderStatusBadge(t.statusCategory, t.status)}
                          <span className="text-muted-foreground/60" title="Synced from Jira (Read-only)">
                            <Lock className="size-2.5" />
                          </span>
                        </div>
                        <span className="text-[10px] text-muted-foreground/70 font-mono tracking-tight">Jira status</span>
                      </div>
                    )}
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
      )}

      {dialog && <TaskDialog task={dialog.task} onClose={() => setDialog(null)} />}
      {starting && <StartWorkflowDialog task={starting} onClose={() => setStarting(null)} />}
    </Page>
  );
}
