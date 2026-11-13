import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTeamActivity, roleOf, type ActivityRow } from './team-activity';

const snapshot = {
  id: 'dev', name: 'Dev', description: '', edges: [],
  nodes: [
    { id: 'impl', type: 'agent.run', label: 'Implement', position: { x: 0, y: 0 }, config: { role: 'engineering/backend-dev', executor: 'claude-cli' } },
    { id: 'review', type: 'ai.review', label: 'Review', position: { x: 0, y: 0 }, config: { role: 'qa/reviewer', engine: 'claude' } },
    { id: 'spec', type: 'ai.step', label: 'Spec', position: { x: 0, y: 0 }, config: { engine: 'gemini' } },
    { id: 'gate', type: 'human.gate', label: 'You review', position: { x: 0, y: 0 }, config: {} },
    { id: 'checks', type: 'check.command', label: 'Checks', position: { x: 0, y: 0 }, config: {} },
  ],
};

let n = 0;
function row(nodeId: string, nodeType: string, status: string, extra: Partial<ActivityRow> = {}): ActivityRow {
  n += 1;
  return {
    id: `nr${n}`, run_id: 'run1', node_id: nodeId, node_type: nodeType, status, attempt: 1, role: null, model: null, cost_usd: null, num_turns: null,
    summary: null, confidence: null, decision_needed: null, error: null, started_at: '2026-11-13T01:00:00Z', ended_at: null, created_at: '2026-11-13T01:00:00Z',
    workflow_id: 'dev', workflow_snapshot: snapshot, task_key: 'DEMO-1', task_title: 'Add login', project_slug: 'demo', ...extra,
  };
}

test('the role comes from the step once recorded, else from its node', () => {
  assert.equal(roleOf(row('impl', 'agent.run', 'queued')), 'engineering/backend-dev');
  assert.equal(roleOf(row('impl', 'agent.run', 'running', { role: 'qa/reviewer' })), 'qa/reviewer');
  assert.equal(roleOf(row('spec', 'ai.step', 'running')), null);
});

test('steps are grouped by role with a state, last step and counts', () => {
  const out = buildTeamActivity([
    row('impl', 'agent.run', 'running', { role: 'engineering/backend-dev', model: 'sonnet' }),
    row('review', 'ai.review', 'done', { role: 'qa/reviewer', ended_at: '2026-11-13T00:30:00Z', cost_usd: 0.25, summary: 'Looks fine.' }),
    row('review', 'ai.review', 'failed', { role: 'qa/reviewer', ended_at: '2026-11-13T00:50:00Z', cost_usd: 0.1, error: 'Timed out\nstack…' }),
    row('spec', 'ai.step', 'queued'),
    row('gate', 'human.gate', 'waiting'),
    row('checks', 'check.command', 'running'),
  ], { windowHours: 24, now: new Date('2026-11-13T02:00:00Z') });

  const dev = out.agents.find(a => a.roleKey === 'engineering/backend-dev')!;
  assert.equal(dev.state, 'running');
  assert.equal(dev.current[0]!.stepLabel, 'Implement');
  assert.equal(dev.current[0]!.engine, 'claude-cli');
  assert.equal(dev.current[0]!.taskKey, 'DEMO-1');

  const qa = out.agents.find(a => a.roleKey === 'qa/reviewer')!;
  assert.equal(qa.state, 'failed');
  assert.equal(qa.last!.error, 'Timed out');
  assert.deepEqual(qa.stats, { done: 1, failed: 1, costUsd: 0.35 });

  const noRole = out.agents.at(-1)!;
  assert.equal(noRole.roleKey, null);
  assert.equal(noRole.state, 'queued');
  assert.equal(noRole.current[0]!.engine, 'gemini');

  assert.deepEqual(out.waitingForYou.map(s => s.step), ['gate']);
  assert.ok(!out.agents.some(a => a.current.some(s => s.step === 'checks')), 'non-AI steps without a role are not agents');
});

test('a step waiting for a confirmation makes its role "waiting"; text is redacted', () => {
  const out = buildTeamActivity([
    row('review', 'ai.review', 'waiting', { role: 'qa/reviewer' }),
    row('impl', 'agent.run', 'failed', { role: 'engineering/backend-dev', ended_at: '2026-11-13T00:00:00Z', error: 'auth failed for ghp_abcdefghijklmnopqrstuvwxyz0123456789' }),
  ], { windowHours: 24 });
  assert.equal(out.agents.find(a => a.roleKey === 'qa/reviewer')!.state, 'waiting');
  assert.doesNotMatch(out.agents.find(a => a.roleKey === 'engineering/backend-dev')!.last!.error!, /ghp_abc/);
});
