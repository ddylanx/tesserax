import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { updateTaskStatusSchema } from '@tesserax/contracts';

test('updateTaskStatusSchema validates valid status categories', () => {
  const r1 = updateTaskStatusSchema.safeParse({ statusCategory: 'todo' });
  assert.equal(r1.success, true);
  if (r1.success) {
    assert.equal(r1.data.statusCategory, 'todo');
    assert.equal(r1.data.status, undefined);
  }

  const r2 = updateTaskStatusSchema.safeParse({ statusCategory: 'in_progress', status: 'In Progress' });
  assert.equal(r2.success, true);
  if (r2.success) {
    assert.equal(r2.data.statusCategory, 'in_progress');
    assert.equal(r2.data.status, 'In Progress');
  }

  const r3 = updateTaskStatusSchema.safeParse({ statusCategory: 'done', status: 'Completed' });
  assert.equal(r3.success, true);
  if (r3.success) {
    assert.equal(r3.data.statusCategory, 'done');
    assert.equal(r3.data.status, 'Completed');
  }
});

test('updateTaskStatusSchema rejects invalid categories and empty status', () => {
  const r1 = updateTaskStatusSchema.safeParse({ statusCategory: 'unknown' });
  assert.equal(r1.success, false);

  const r2 = updateTaskStatusSchema.safeParse({});
  assert.equal(r2.success, false);

  const r3 = updateTaskStatusSchema.safeParse({ statusCategory: 'todo', status: '' });
  assert.equal(r3.success, false);
});
