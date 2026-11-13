import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  activeRun,
  boardColumn,
  canDragCard,
  compareCards,
  compareCardsBy,
  laneOf,
  matchesQuickFilters,
  NO_VALUE,
  sortLanes,
  latestRunByTask,
} from '@tesserax/contracts';
import { pickRelease } from './jira/map';

test('boardColumn handles active runs and task status categories', () => {
  // run running -> in_progress
  assert.equal(
    boardColumn({ statusCategory: 'todo' }, { status: 'running' }),
    'in_progress',
  );
  assert.equal(
    boardColumn({ statusCategory: 'done' }, { status: 'running' }),
    'in_progress',
  );

  // run waiting -> in_review
  assert.equal(
    boardColumn({ statusCategory: 'todo' }, { status: 'waiting' }),
    'in_review',
  );
  assert.equal(
    boardColumn({ statusCategory: 'in_progress' }, { status: 'waiting' }),
    'in_review',
  );

  // run failed + done -> done
  assert.equal(
    boardColumn({ statusCategory: 'done' }, { status: 'failed' }),
    'done',
  );

  // run failed + todo -> todo
  assert.equal(
    boardColumn({ statusCategory: 'todo' }, { status: 'failed' }),
    'todo',
  );

  // no run with each statusCategory
  assert.equal(boardColumn({ statusCategory: 'todo' }, null), 'todo');
  assert.equal(
    boardColumn({ statusCategory: 'in_progress' }, null),
    'in_progress',
  );
  assert.equal(boardColumn({ statusCategory: 'done' }, null), 'done');
});

test('latestRunByTask retains the newest run regardless of input order', () => {
  const older = {
    task: { id: 't1' },
    status: 'done' as const,
    createdAt: '2026-10-10T10:00:00.000Z',
  };
  const newer = {
    task: { id: 't1' },
    status: 'running' as const,
    createdAt: '2026-10-12T10:00:00.000Z',
  };

  // older then newer
  const map1 = latestRunByTask([older, newer]);
  assert.equal(map1.get('t1')?.createdAt, newer.createdAt);
  assert.equal(map1.get('t1')?.status, 'running');

  // newer then older
  const map2 = latestRunByTask([newer, older]);
  assert.equal(map2.get('t1')?.createdAt, newer.createdAt);
  assert.equal(map2.get('t1')?.status, 'running');
});

test('activeRun returns run only when running, waiting, or failed', () => {
  assert.equal(activeRun(undefined), null);

  const doneRun = {
    task: { id: 't1' },
    status: 'done' as const,
    createdAt: '2026-10-10T10:00:00.000Z',
  };
  assert.equal(activeRun(doneRun), null);

  const cancelledRun = {
    task: { id: 't1' },
    status: 'cancelled' as const,
    createdAt: '2026-10-10T10:00:00.000Z',
  };
  assert.equal(activeRun(cancelledRun), null);

  const runningRun = {
    task: { id: 't1' },
    status: 'running' as const,
    createdAt: '2026-10-10T10:00:00.000Z',
  };
  assert.equal(activeRun(runningRun), runningRun);

  const waitingRun = {
    task: { id: 't1' },
    status: 'waiting' as const,
    createdAt: '2026-10-10T10:00:00.000Z',
  };
  assert.equal(activeRun(waitingRun), waitingRun);

  const failedRun = {
    task: { id: 't1' },
    status: 'failed' as const,
    createdAt: '2026-10-10T10:00:00.000Z',
  };
  assert.equal(activeRun(failedRun), failedRun);
});

test('canDragCard checks task source and active run state', () => {
  // Jira -> false
  assert.equal(canDragCard({ source: 'jira' }, null), false);
  assert.equal(
    canDragCard({ source: 'jira' }, { status: 'running' }),
    false,
  );

  // local + running -> false
  assert.equal(
    canDragCard({ source: 'local' }, { status: 'running' }),
    false,
  );

  // local + waiting -> false
  assert.equal(
    canDragCard({ source: 'local' }, { status: 'waiting' }),
    false,
  );

  // local + failed -> true
  assert.equal(
    canDragCard({ source: 'local' }, { status: 'failed' }),
    true,
  );

  // local + null -> true
  assert.equal(canDragCard({ source: 'local' }, null), true);
});

test('compareCards orders by priority, then updatedAt desc, then id', () => {
  // High before Low
  const high = { id: '1', priority: 'High', updatedAt: '2026-10-10T00:00:00Z' };
  const low = { id: '2', priority: 'Low', updatedAt: '2026-10-10T00:00:00Z' };
  assert.ok(compareCards(high, low) < 0);
  assert.ok(compareCards(low, high) > 0);

  // Same priority, newer before older
  const older = { id: '1', priority: 'Medium', updatedAt: '2026-10-10T00:00:00Z' };
  const newer = { id: '2', priority: 'Medium', updatedAt: '2026-10-15T00:00:00Z' };
  assert.ok(compareCards(newer, older) < 0);
  assert.ok(compareCards(older, newer) > 0);

  // null priority at the end
  const nullPri = { id: '3', priority: null, updatedAt: '2026-10-16T00:00:00Z' };
  assert.ok(compareCards(low, nullPri) < 0);
  assert.ok(compareCards(nullPri, low) > 0);

  // null updatedAt at the end
  const nullUpdated = { id: '4', priority: 'Medium', updatedAt: null };
  assert.ok(compareCards(older, nullUpdated) < 0);
  assert.ok(compareCards(nullUpdated, older) > 0);

  // Same priority and updatedAt, ordered by id
  const idA = { id: 'a', priority: 'Low', updatedAt: '2026-10-10T00:00:00Z' };
  const idB = { id: 'b', priority: 'Low', updatedAt: '2026-10-10T00:00:00Z' };
  assert.ok(compareCards(idA, idB) < 0);
});

test('pickRelease: earliest unreleased version, else the latest released', () => {
  assert.equal(pickRelease(undefined), null);
  assert.equal(pickRelease([]), null);
  assert.equal(
    pickRelease([
      { name: 'v2', released: false, releaseDate: '2026-12-01' },
      { name: 'v1.5', released: false, releaseDate: '2026-11-20' },
      { name: 'v1', released: true, releaseDate: '2026-10-01' },
      { name: 'vNext', released: false },
    ]),
    'v1.5',
  );
  assert.equal(pickRelease([{ name: 'v1', released: true, releaseDate: '2026-01-01' }, { name: 'v2', released: true, releaseDate: '2026-05-01' }]), 'v2');
});

test('sortLanes: natural order, priority by rank, empty lane last', () => {
  assert.deepEqual(sortLanes(['v1.10', null, 'v1.2', 'v1.2'], 'release'), ['v1.2', 'v1.10', null]);
  assert.deepEqual(sortLanes(['Low', 'Highest', null, 'Medium'], 'priority'), ['Highest', 'Medium', 'Low', null]);
  assert.equal(laneOf({ release: null, sprint: 'S1', priority: null, assignee: null, parent: 'E-1 Epic' }, 'epic'), 'E-1 Epic');
});

test('compareCardsBy: missing values last, updated newest first', () => {
  const card = (id: string, dueAt: string | null, updatedAt: string | null, key: string | null = null) => ({ id, dueAt, updatedAt, key, priority: null });
  const due = [card('a', null, null), card('b', '2026-12-01', null), card('c', '2026-11-01', null)].sort(compareCardsBy('due'));
  assert.deepEqual(due.map(c => c.id), ['c', 'b', 'a']);
  const upd = [card('a', null, '2026-01-01'), card('b', null, '2026-02-01')].sort(compareCardsBy('updated'));
  assert.deepEqual(upd.map(c => c.id), ['b', 'a']);
  const keys = [card('a', null, null, 'T-10'), card('b', null, null, 'T-9')].sort(compareCardsBy('key'));
  assert.deepEqual(keys.map(c => c.id), ['b', 'a']);
});

test('matchesQuickFilters: any, exact, and "none"', () => {
  const t = { release: 'v1', priority: 'High', assignee: null, type: 'Bug' };
  assert.ok(matchesQuickFilters(t, {}));
  assert.ok(matchesQuickFilters(t, { release: 'v1', assignee: NO_VALUE }));
  assert.ok(!matchesQuickFilters(t, { priority: 'Low' }));
  assert.ok(!matchesQuickFilters(t, { release: NO_VALUE }));
});
