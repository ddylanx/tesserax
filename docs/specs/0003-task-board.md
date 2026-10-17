# Spec 0003: Task board (Kanban)

Status: proposed (2026-10-17)

## Goal

See the work in flight at a glance, the way a Jira board shows it: one card per task, in a column that says where the
task is. The board also shows what the agents are doing: a task whose run is working sits in "In progress", and a task
whose run waits at a human gate sits in "In review", without anyone dragging it there.

Non-goals for this spec (later, built on top of it): writing a status change back to Jira (transitions API), manual
ordering inside a column, swimlanes, WIP limits, live updates over SSE, starting a workflow by dropping a card.

## Decisions

| # | Question | Decision |
|---|---|---|
| 1 | Use an open-source board or build our own? | Build our own board. A full board app (Planka, Wekan, Kanboard…) has its own database and would need two-way sync, and does not know about runs; Planka is AGPL, which does not fit this Apache-2.0 repo. |
| 2 | Which drag-and-drop library? | `@atlaskit/pragmatic-drag-and-drop` (Apache-2.0, actively maintained, small core), with its `auto-scroll` and `hitbox` add-ons (Apache-2.0). `@dnd-kit/core` has had no release since 12/2024 and its successor `@dnd-kit/react` is still 0.x. |
| 3 | Which columns? | To do / In progress / In review / Done. |
| 4 | Where does a card's column come from? | An active run decides first (see the table below), else the task's `status_category`. |
| 5 | Which cards can be dragged? | Local tasks with no active run. Jira tasks are read-only (their status comes from Jira sync) and show a lock. |
| 6 | Order inside a column | Priority (highest first), then `updated_at_source` (newest first). No manual ordering yet, so no new column. |
| 7 | How much "Done" to load? | Done tasks updated in the last 14 days, 50 at a time with "Load more". To do and In progress load in full, as the list does today. |
| 8 | Refresh | Polling as on the Tasks page today (tasks 30 s, runs 15 s) plus a refetch after every drop. |

`saltbo/agent-kanban` was used as a reference for ideas only (the review column, run-driven moves). Its license is
FSL-1.1-ALv2, not open source, so none of its code is copied here.

### Column of a card

Computed by one pure function, `boardColumn(task, activeRun)`, in `@tesserax/contracts` so the web app and tests share
it. `activeRun` is the task's latest run when its status is `running`, `waiting` or `failed` (the same set the Tasks
page already uses).

| Active run | Column | Card badge |
|---|---|---|
| `running` | In progress | "Running", with the current node |
| `waiting` (a `human.gate` waits for you) | In review | "Waiting for you" |
| `failed` | the column from `status_category` | "Failed" in red |
| none | `todo` → To do, `in_progress` → In progress, `done` → Done | – |

"In review" is fed only by runs in v1: `status_category` keeps its three values and a card cannot be dropped there.

## Module and data

No migration. The board reads the same task list and run list as the Tasks page and computes columns in the browser,
so the tasks module does not need to read workflow runs (module boundaries from spec 0002 stay as they are).

Contract changes in `@tesserax/contracts` (`taskQuerySchema`):

```ts
{
  ...existing filters,
  updatedSince: string | undefined;   // ISO date; tasks with updated_at_source >= it
  limit: number | undefined;          // 1–500, default 500
  cursor: string | undefined;         // opaque; from the previous page's nextCursor
}
// taskListSchema gains: nextCursor: string | null
```

The cursor is keyset on `(updated_at_source desc, id desc)`, served by the existing index
`(project_id, status_category, updated_at_source)`.

The board makes two task requests with the current filters (project, board, source, search):

1. `GET /api/tasks?includeDone=0` → To do and In progress;
2. `GET /api/tasks?statusCategory=done&updatedSince=<now − 14 days>&limit=50[&cursor=…]` → Done, paged.

A drop calls the existing `PATCH /api/tasks/:id/status` with the target column's `statusCategory`.

## Flows

**Open the board.** On the Tasks page a "List / Board" switch picks the view; the choice is kept in local storage with
the other filters. Filters, search and the project picker apply to both views.

**Drag a card.** Only a local task with no active run can be picked up. Valid drop targets are To do, In progress and
Done; In review and the card's own column are not highlighted. On drop the card moves at once (optimistic update),
the status request is sent, and the task list is refetched. If the request fails, the card goes back and a toast shows
the error.

**A run changes.** On the next run poll the card moves by itself (for example from In progress to In review when a run
reaches a gate). Clicking the run badge opens the run.

**Keyboard and touch.** Drag-and-drop is not the only way: every draggable card has a "Move to…" menu (To do / In
progress / Done) that calls the same endpoint, so the board works by keyboard and screen reader.

## UI

- **Card:** Jira key or "Local", title (two lines max), type and priority badges (the ones the list already uses),
  assignee, project color dot in "All", run badge, lock icon on Jira tasks. Clicking the card opens the existing task
  dialog.
- **Column header:** name and count; Done shows "last 14 days" and a "Load more" button at the bottom.
- **Layout:** four equal columns that scroll vertically on their own; the page scrolls horizontally on narrow screens.
  Auto-scroll while dragging near a column edge.
- **Empty column:** a short muted line ("Nothing here").

## Testing

- `boardColumn`: every row of the column table, including a failed run on a done task and no run at all.
- Task list paging: `limit` + `cursor` returns every done task once, in order; `updatedSince` filters; `nextCursor` is
  null on the last page.
- Status endpoint (existing): a Jira task is refused, a local task moves.
- By hand in the running app: drag local cards between columns, a refused drop rolls back, a Jira card cannot be picked
  up, a run reaching a gate moves its card to In review.

## Later

- Write a drop on a Jira card back to Jira with the transitions API (needs write access, and a change to the rule that
  only `postJiraComment` writes to Jira, with the same explicit confirmed click), and map Jira's own statuses to
  columns per board.
- Manual ordering with a fractional index (LexoRank-style string), so a drop writes one row.
- A virtualized column once a column regularly holds more than ~200 cards.
- Live updates over SSE instead of polling.
