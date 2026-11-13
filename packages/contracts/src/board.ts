import type { TaskDto } from './tasks';
import type { WorkflowRunDto } from './workflow';

export const BOARD_COLUMNS = ['todo', 'in_progress', 'in_review', 'done'] as const;
export type BoardColumn = (typeof BOARD_COLUMNS)[number];

/** Columns a card may be dropped on. "In review" is only filled by runs waiting at a gate. */
export const DROPPABLE_COLUMNS = ['todo', 'in_progress', 'done'] as const;
export type DroppableColumn = (typeof DROPPABLE_COLUMNS)[number];

export const BOARD_COLUMN_LABELS: Record<BoardColumn, string> = {
  todo: 'To do',
  in_progress: 'In progress',
  in_review: 'In review',
  done: 'Done',
};

type RunLike = Pick<WorkflowRunDto, 'status' | 'createdAt'> & { task: { id: string } };

/** The newest run (by createdAt) of each task. */
export function latestRunByTask<R extends RunLike>(runs: R[]): Map<string, R> {
  const map = new Map<string, R>();
  for (const run of runs) {
    const existing = map.get(run.task.id);
    if (!existing || run.createdAt > existing.createdAt) {
      map.set(run.task.id, run);
    }
  }
  return map;
}

/** The run that drives the board: the latest run when it is running, waiting or failed; else null. */
export function activeRun<R extends RunLike>(latest: R | undefined): R | null {
  if (!latest) return null;
  if (latest.status === 'running' || latest.status === 'waiting' || latest.status === 'failed') {
    return latest;
  }
  return null;
}

/** Column of a card (spec 0003, "Column of a card"). */
export function boardColumn(
  task: Pick<TaskDto, 'statusCategory'>,
  run: Pick<WorkflowRunDto, 'status'> | null,
): BoardColumn {
  if (run?.status === 'running') return 'in_progress';
  if (run?.status === 'waiting') return 'in_review';
  return task.statusCategory;
}

/** A card can be dragged when it is a local task and no run is running or waiting on it. */
export function canDragCard(
  task: Pick<TaskDto, 'source'>,
  run: Pick<WorkflowRunDto, 'status'> | null,
): boolean {
  return task.source === 'local' && (run === null || run.status === 'failed');
}

export function priorityRank(priority: string | null | undefined): number {
  if (!priority) return 5;
  const p = priority.trim().toLowerCase();
  switch (p) {
    case 'highest':
    case 'blocker':
    case 'critical':
      return 0;
    case 'high':
      return 1;
    case 'medium':
      return 2;
    case 'low':
      return 3;
    case 'lowest':
      return 4;
    default:
      return 5;
  }
}

/** Order inside a column: priority (Highest first), then updatedAt (newest first), then id. */
export function compareCards(
  a: Pick<TaskDto, 'priority' | 'updatedAt' | 'id'>,
  b: Pick<TaskDto, 'priority' | 'updatedAt' | 'id'>,
): number {
  const pDiff = priorityRank(a.priority) - priorityRank(b.priority);
  if (pDiff !== 0) return pDiff;

  if (a.updatedAt !== null && b.updatedAt === null) return -1;
  if (a.updatedAt === null && b.updatedAt !== null) return 1;
  if (a.updatedAt !== null && b.updatedAt !== null) {
    const uDiff = b.updatedAt.localeCompare(a.updatedAt);
    if (uDiff !== 0) return uDiff;
  }

  return a.id.localeCompare(b.id);
}

export const BOARD_SORTS = ['priority', 'updated', 'due', 'key'] as const;
export type BoardSort = (typeof BOARD_SORTS)[number];
export const BOARD_SORT_LABELS: Record<BoardSort, string> = { priority: 'Priority', updated: 'Last updated', due: 'Due date', key: 'Key' };

type SortableCard = Pick<TaskDto, 'priority' | 'updatedAt' | 'id' | 'dueAt' | 'key'>;
const naturalCollator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

/** Order inside a column for the picked sort; ties fall back to compareCards. Missing values go last. */
export function compareCardsBy(sort: BoardSort): (a: SortableCard, b: SortableCard) => number {
  if (sort === 'priority') return compareCards;
  const pick = (t: SortableCard) => (sort === 'due' ? t.dueAt : sort === 'key' ? t.key : t.updatedAt);
  const dir = sort === 'updated' ? -1 : 1;
  return (a, b) => {
    const va = pick(a);
    const vb = pick(b);
    if (va !== vb) {
      if (va === null) return 1;
      if (vb === null) return -1;
      const d = naturalCollator.compare(va, vb) * dir;
      if (d !== 0) return d;
    }
    return compareCards(a, b);
  };
}

export const BOARD_GROUPS = ['none', 'release', 'sprint', 'priority', 'assignee', 'epic'] as const;
export type BoardGroup = (typeof BOARD_GROUPS)[number];
export const BOARD_GROUP_LABELS: Record<BoardGroup, string> = {
  none: 'None', release: 'Release', sprint: 'Sprint', priority: 'Priority', assignee: 'Assignee', epic: 'Epic',
};

type GroupableCard = Pick<TaskDto, 'release' | 'sprint' | 'priority' | 'assignee' | 'parent'>;

/** Swimlane of a card; null = the "No …" lane. */
export function laneOf(task: GroupableCard, group: BoardGroup): string | null {
  switch (group) {
    case 'release': return task.release;
    case 'sprint': return task.sprint;
    case 'priority': return task.priority;
    case 'assignee': return task.assignee;
    case 'epic': return task.parent;
    default: return null;
  }
}

/** Lanes in display order: priority by rank, others by natural name order (v1.2 before v1.10); the null lane last. */
export function sortLanes(lanes: (string | null)[], group: BoardGroup): (string | null)[] {
  return [...new Set(lanes)].sort((a, b) => {
    if (a === b) return 0;
    if (a === null) return 1;
    if (b === null) return -1;
    if (group === 'priority') {
      const d = priorityRank(a) - priorityRank(b);
      if (d !== 0) return d;
    }
    return naturalCollator.compare(a, b);
  });
}

/** Quick filters (Release, Priority, Assignee, Type) applied in the browser; an empty value means "any". "__none" matches a missing value. */
export interface QuickFilters {
  release?: string;
  priority?: string;
  assignee?: string;
  type?: string;
}
export const NO_VALUE = '__none';

export function matchesQuickFilters(task: Pick<TaskDto, 'release' | 'priority' | 'assignee' | 'type'>, f: QuickFilters): boolean {
  return (['release', 'priority', 'assignee', 'type'] as const).every(k => {
    const want = f[k];
    if (!want) return true;
    return want === NO_VALUE ? !task[k] : task[k] === want;
  });
}
