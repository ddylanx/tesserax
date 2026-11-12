import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { Lock, X } from 'lucide-react';
import {
  activeRun,
  boardColumn,
  canDragCard,
  compareCards,
  BOARD_COLUMNS,
  BOARD_COLUMN_LABELS,
  DROPPABLE_COLUMNS,
  type BoardColumn,
  type DroppableColumn,
  type TaskDto,
  type WorkflowRunDto,
} from '@tesserax/contracts';
import { draggable, dropTargetForElements, monitorForElements } from '@atlaskit/pragmatic-drag-and-drop/element/adapter';
import { combine } from '@atlaskit/pragmatic-drag-and-drop/combine';
import { autoScrollForElements } from '@atlaskit/pragmatic-drag-and-drop-auto-scroll/element';
import { cn } from '@/lib/utils';
import { ProjectDot } from '@/lib/project-context';
import { Button } from '@/components/ui/button';
import { StatusPill } from '@/components/ui/status-pill';
import { renderPriorityBadge, renderTypeBadge } from '@/components/task-badges';

export interface TaskBoardProps {
  tasks: TaskDto[];
  runs: Map<string, WorkflowRunDto>;
  showProjectDot: boolean;
  doneHasMore: boolean;
  doneLoadingMore: boolean;
  onLoadMoreDone: () => void;
  onMove: (task: TaskDto, to: DroppableColumn) => void;
  onOpen: (task: TaskDto) => void;
  error?: string | null;
  onDismissError?: () => void;
}

interface BoardCardProps {
  task: TaskDto;
  column: BoardColumn;
  run: WorkflowRunDto | null;
  showProjectDot: boolean;
  onMove: (task: TaskDto, to: DroppableColumn) => void;
  onOpen: (task: TaskDto) => void;
}

function BoardCard({
  task,
  column,
  run,
  showProjectDot,
  onMove,
  onOpen,
}: BoardCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const canDrag = canDragCard(task, run);

  useEffect(() => {
    if (!canDrag || !cardRef.current) return;
    return draggable({
      element: cardRef.current,
      getInitialData: () => ({ type: 'task-card', taskId: task.id, from: column }),
      onDragStart: () => setDragging(true),
      onDrop: () => setDragging(false),
    });
  }, [canDrag, task.id, column]);

  return (
    <div
      ref={cardRef}
      onClick={() => onOpen(task)}
      className={cn(
        'rounded-lg border border-border bg-card p-3 shadow-2xs transition-colors hover:border-foreground/30 flex flex-col gap-2 select-none',
        canDrag ? 'cursor-grab active:cursor-grabbing' : 'cursor-default',
        dragging && 'opacity-40',
      )}
    >
      {/* Row 1: ProjectDot, key/Local, lock icon */}
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <div className="flex items-center gap-1.5 min-w-0">
          {showProjectDot && <ProjectDot color={task.projectColor} name={task.projectSlug} />}
          <span className="font-mono text-[11px] font-medium truncate">
            {task.key ?? 'Local'}
          </span>
        </div>
        {task.source !== 'local' && (
          <span title="Synced from Jira (read-only)" className="inline-flex shrink-0">
            <Lock className="size-3 text-muted-foreground" />
          </span>
        )}
      </div>

      {/* Row 2: Title */}
      <div className="text-sm font-medium leading-snug line-clamp-2 text-foreground">
        {task.title}
      </div>

      {/* Row 3: Badges & Assignee */}
      <div className="flex flex-wrap items-center gap-1.5">
        {renderTypeBadge(task.type)}
        {renderPriorityBadge(task.priority)}
        {task.assignee && (
          <span className="text-[11px] text-muted-foreground ml-auto truncate max-w-[120px]" title={task.assignee}>
            {task.assignee}
          </span>
        )}
      </div>

      {/* Active Run Badge */}
      {run && (
        <div className="pt-0.5">
          {run.status === 'running' && (
            <Link
              to="/runs/$runId"
              params={{ runId: run.id }}
              onClick={e => e.stopPropagation()}
              className="inline-flex max-w-full rounded-md hover:opacity-80"
            >
              <StatusPill tone="info" pulse className="truncate">Running{run.currentNodeLabel ? ` · ${run.currentNodeLabel}` : ''} →</StatusPill>
            </Link>
          )}
          {run.status === 'waiting' && (
            <Link
              to="/runs/$runId"
              params={{ runId: run.id }}
              onClick={e => e.stopPropagation()}
              className="inline-flex max-w-full rounded-md hover:opacity-80"
            >
              <StatusPill tone="warning" pulse>Waiting for you →</StatusPill>
            </Link>
          )}
          {run.status === 'failed' && (
            <Link
              to="/runs/$runId"
              params={{ runId: run.id }}
              onClick={e => e.stopPropagation()}
              className="inline-flex max-w-full rounded-md hover:opacity-80"
            >
              <StatusPill tone="destructive">Failed →</StatusPill>
            </Link>
          )}
        </div>
      )}

      {/* Move to... for keyboard and touch */}
      {canDrag && (
        <div className="flex justify-end pt-1">
          <select
            value=""
            aria-label="Move task to column"
            onClick={e => e.stopPropagation()}
            onPointerDown={e => e.stopPropagation()}
            onChange={e => {
              const val = e.target.value as DroppableColumn;
              if (val) onMove(task, val);
            }}
            className="text-[11px] rounded border border-border bg-background px-1.5 py-0.5 text-muted-foreground outline-none hover:text-foreground cursor-pointer"
          >
            <option value="" disabled>Move to…</option>
            {DROPPABLE_COLUMNS.filter(c => c !== column).map(c => (
              <option key={c} value={c}>
                {BOARD_COLUMN_LABELS[c]}
              </option>
            ))}
          </select>
        </div>
      )}
    </div>
  );
}

interface BoardColumnViewProps {
  column: BoardColumn;
  tasks: TaskDto[];
  runs: Map<string, WorkflowRunDto>;
  showProjectDot: boolean;
  doneHasMore: boolean;
  doneLoadingMore: boolean;
  onLoadMoreDone: () => void;
  onMove: (task: TaskDto, to: DroppableColumn) => void;
  onOpen: (task: TaskDto) => void;
}

function BoardColumnView({
  column,
  tasks,
  runs,
  showProjectDot,
  doneHasMore,
  doneLoadingMore,
  onLoadMoreDone,
  onMove,
  onOpen,
}: BoardColumnViewProps) {
  const columnRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [over, setOver] = useState(false);

  useEffect(() => {
    if (!columnRef.current || !scrollRef.current) return;
    return combine(
      dropTargetForElements({
        element: columnRef.current,
        canDrop: ({ source }) =>
          source.data.type === 'task-card' && column !== 'in_review' && source.data.from !== column,
        getData: () => ({ column }),
        onDragEnter: () => setOver(true),
        onDragLeave: () => setOver(false),
        onDrop: () => setOver(false),
      }),
      autoScrollForElements({ element: scrollRef.current }),
    );
  }, [column]);

  return (
    <div
      ref={columnRef}
      className={cn(
        'flex flex-col rounded-lg bg-muted/40 p-2.5 max-h-[calc(100dvh-308px)] transition-all',
        over && 'ring-2 ring-primary/50',
      )}
    >
      {/* Column Header */}
      <div className="flex items-center justify-between px-1.5 py-1 mb-2 shrink-0">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-sm">{BOARD_COLUMN_LABELS[column]}</span>
          {column === 'done' && (
            <span className="text-[11px] text-muted-foreground">last 14 days</span>
          )}
        </div>
        <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
          {tasks.length}
        </span>
      </div>

      {/* Scrollable Card List */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto space-y-2.5 pr-1 min-h-[120px]">
        {tasks.length === 0 ? (
          <div className="flex items-center justify-center h-24 text-xs text-muted-foreground">
            Nothing here
          </div>
        ) : (
          tasks.map(t => (
            <BoardCard
              key={t.id}
              task={t}
              column={column}
              run={activeRun(runs.get(t.id))}
              showProjectDot={showProjectDot}
              onMove={onMove}
              onOpen={onOpen}
            />
          ))
        )}

        {/* Load more button in Done column */}
        {column === 'done' && doneHasMore && (
          <div className="pt-2 text-center shrink-0">
            <Button
              variant="ghost"
              size="sm"
              className="w-full text-xs text-muted-foreground hover:text-foreground"
              disabled={doneLoadingMore}
              onClick={onLoadMoreDone}
            >
              {doneLoadingMore ? 'Loading…' : 'Load more'}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

export function TaskBoard({
  tasks,
  runs,
  showProjectDot,
  doneHasMore,
  doneLoadingMore,
  onLoadMoreDone,
  onMove,
  onOpen,
  error,
  onDismissError,
}: TaskBoardProps) {
  const tasksById = useRef<Map<string, TaskDto>>(new Map());
  const onMoveRef = useRef(onMove);
  useEffect(() => {
    onMoveRef.current = onMove;
  });

  const columns = useMemo(() => {
    const map = new Map<string, TaskDto>();
    const cols: Record<BoardColumn, TaskDto[]> = {
      todo: [],
      in_progress: [],
      in_review: [],
      done: [],
    };

    for (const task of tasks) {
      map.set(task.id, task);
      const run = activeRun(runs.get(task.id));
      const col = boardColumn(task, run);
      cols[col].push(task);
    }

    tasksById.current = map;

    for (const col of BOARD_COLUMNS) {
      cols[col].sort(compareCards);
    }

    return cols;
  }, [tasks, runs]);

  useEffect(() => {
    return monitorForElements({
      canMonitor: ({ source }) => source.data.type === 'task-card',
      onDrop: ({ source, location }) => {
        const target = location.current.dropTargets[0];
        if (!target) return;
        const to = target.data.column as BoardColumn;
        if (to === 'in_review' || to === source.data.from) return;
        const task = tasksById.current.get(source.data.taskId as string);
        if (task) onMoveRef.current(task, to as DroppableColumn);
      },
    });
  }, []);

  return (
    <div>
      {error && (
        <div className="mb-3 flex items-center justify-between rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          <span>{error}</span>
          {onDismissError && (
            <button
              type="button"
              onClick={onDismissError}
              className="ml-2 rounded p-0.5 hover:bg-destructive/20 text-destructive cursor-pointer"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>
      )}

      <div className="overflow-x-auto pb-4">
        <div className="grid grid-cols-4 gap-3 min-w-[960px]">
          {BOARD_COLUMNS.map(col => (
            <BoardColumnView
              key={col}
              column={col}
              tasks={columns[col]}
              runs={runs}
              showProjectDot={showProjectDot}
              doneHasMore={doneHasMore}
              doneLoadingMore={doneLoadingMore}
              onLoadMoreDone={onLoadMoreDone}
              onMove={onMove}
              onOpen={onOpen}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
