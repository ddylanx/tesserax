import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  activeRun,
  boardColumn,
  canDragCard,
  compareCards,
  latestRunByTask,
} from '@tesserax/contracts';

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
