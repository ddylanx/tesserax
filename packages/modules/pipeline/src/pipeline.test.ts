import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { ACTIVE_PIPELINE_STATES, PIPELINE_STATES, type TaskDetailDto } from '@ot/contracts';
import { RulesClassifier } from '@ot/mod-classify';
import { TRANSITIONS, canTransition } from './states';

test('every state has a transition entry; terminal states have none', () => {
  for (const s of PIPELINE_STATES) assert.ok(s in TRANSITIONS, s);
  for (const s of ['rejected', 'verified_true', 'verified_false', 'cancelled'] as const) assert.deepEqual(TRANSITIONS[s], []);
  // every non-terminal (active) state can be cancelled
  for (const s of ACTIVE_PIPELINE_STATES) assert.ok(canTransition(s, 'cancelled'), s);
});

test('the main path is allowed and shortcuts are not', () => {
  const path = ['new', 'classifying', 'awaiting_decision', 'queued', 'running_playbook', 'awaiting_verify', 'verified_true'] as const;
  for (let i = 0; i < path.length - 1; i++) assert.ok(canTransition(path[i]!, path[i + 1]!), `${path[i]} -> ${path[i + 1]}`);
  assert.ok(!canTransition('awaiting_decision', 'running_playbook'));
  assert.ok(!canTransition('classifying', 'verified_true'));
  assert.ok(canTransition('failed', 'classifying') && canTransition('failed', 'queued'));
});

const task = (over: Partial<TaskDetailDto>): TaskDetailDto => ({
  id: '1', workspace: 'company', source: 'jira', key: 'A-1', title: 'x', status: null, statusCategory: 'todo', priority: null,
  assignee: null, project: 'A', type: null, labels: [], url: null, dueAt: null, updatedAt: null, archived: false,
  description: null, reporter: null, components: [], parent: null, sprint: null, createdAt: null, comments: [], attachments: [], review: null, ...over,
});
const playbooks = [
  { id: 'investigate-bug', name: '', appliesTo: ['bug'], description: '' },
  { id: 'research-question', name: '', appliesTo: ['question', 'research'], description: '' },
];

test('rules classifier: bug, question by title, chore', async () => {
  const r = new RulesClassifier();
  const bug = await r.classify({ task: task({ type: 'Bug' }), playbooks, mappedRepo: '/r' });
  assert.equal(bug.type, 'bug');
  assert.equal(bug.playbook, 'investigate-bug');
  assert.equal(bug.repo, '/r');
  const q = await r.classify({ task: task({ type: 'Task', title: 'How many retries?' }), playbooks, mappedRepo: null });
  assert.equal(q.type, 'question');
  assert.equal(q.automation, 'auto');
  assert.equal((await r.classify({ task: task({ type: 'Chore' }), playbooks, mappedRepo: null })).playbook, null);
});
