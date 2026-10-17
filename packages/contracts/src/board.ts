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

function priorityRank(priority: string | null | undefined): number {
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
