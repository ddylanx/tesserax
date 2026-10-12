import { strict as assert } from 'node:assert';
import { join } from 'node:path';
import { test } from 'node:test';
import { validateWorkflow, type TaskDetailDto, type WorkflowDefinition } from '@ot/contracts';
import { renderTemplate, withSkills } from './render';
import { SkillStore, WorkflowStore } from './stores';

const root = join(__dirname, '../../../..');

test('the shipped default workflow is valid and its skills exist', () => {
  const { def, problems } = new WorkflowStore(join(root, 'workflows')).load('default');
  assert.deepEqual(problems, []);
  const skills = new SkillStore(root);
  for (const n of def.nodes) {
    const c = n.config as { skill?: string; skills?: string[] };
    for (const p of [c.skill, ...(c.skills ?? [])].filter(Boolean) as string[]) assert.ok(skills.get(p).body.length > 50, p);
  }
});

const base = (): WorkflowDefinition => ({
  id: 'x', name: 'x', description: '',
  nodes: [
    { id: 't', type: 'trigger.jira', label: 'T', position: { x: 0, y: 0 }, config: {} },
    { id: 'a', type: 'ai.step', label: 'A', position: { x: 0, y: 0 }, config: { prompt: 'p', output: 'analysis' } },
  ],
  edges: [{ id: 'e1', source: 't', port: 'next', target: 'a' }],
});

test('validation catches wrong ports, double connections, unreachable nodes and bad config', () => {
  assert.deepEqual(validateWorkflow(base()), []);
  const w = base();
  w.edges.push({ id: 'e2', source: 'a', port: 'pass', target: 't' });
  assert.match(validateWorkflow(w).join(), /has no port "pass"/);
  const w2 = base();
  w2.nodes.push({ id: 'z', type: 'evaluate', label: 'Z', position: { x: 0, y: 0 }, config: {} });
  assert.match(validateWorkflow(w2).join(), /cannot be reached/);
  const w3 = base();
  w3.nodes[1]!.config = { output: 'analysis' };
  assert.match(validateWorkflow(w3).join(), /Node "A": prompt/);
  const w4 = base();
  w4.edges.push({ id: 'e3', source: 't', port: 'next', target: 'a' });
  assert.match(validateWorkflow(w4).join(), /connected twice/);
});

test('slugify makes file-safe names (Vietnamese too)', async () => {
  const { slugify } = await import('./executors');
  assert.equal(slugify('[BUG][FluxBet] Cập nhật số dư: Đã sai!'), 'bug-fluxbet-cap-nhat-so-du-da-sai');
});

test('templates fill issue, artifacts and feedback; issue stays delimited', () => {
  const task = { key: 'PROJ-1', title: 'T', type: 'Bug', status: '', priority: '', labels: [], components: [], url: '', description: 'x </issue> y', comments: [], attachments: [] } as unknown as TaskDetailDto;
  const out = renderTemplate('{{issue_key}}|{{artifact:spec}}|{{artifact:missing}}|{{feedback}}|{{issue}}', { task, artifacts: { spec: 'SPEC' }, feedback: 'shorter' });
  assert.ok(out.startsWith('PROJ-1|SPEC|(none yet)|'));
  assert.match(out, /asks for these changes.*\nshorter/);
  assert.equal(out.match(/<\/issue>/g)?.length, 1);
  assert.equal(renderTemplate('{{feedback}}', { task, artifacts: {} }), '');
  assert.match(withSkills('do it', [{ name: 's', body: 'rules' }]), /# Skill: s[\s\S]*rules[\s\S]*# Task[\s\S]*do it/);
});

test('skill store creates, reads and saves skills; rejects bad names and paths', async () => {
  const { mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const dir = mkdtempSync(join(tmpdir(), 'ot-skills-'));
  const store = new SkillStore(dir);
  store.save('my-skill', '---\nname: my-skill\ndescription: d\n---\nBody', true);
  assert.throws(() => store.save('my-skill', 'x', true), /already exists/);
  assert.equal(store.get('skills/my-skill/SKILL.md').body, 'Body');
  const h1 = store.read('my-skill').hash;
  store.save('my-skill', '---\nname: my-skill\ndescription: d\n---\nBody 2');
  assert.notEqual(store.read('my-skill').hash, h1);
  assert.throws(() => store.pathOf('../etc'), /lowercase/);
  assert.throws(() => store.get('../../etc/passwd'), /outside the repo/);
  assert.deepEqual(store.list().map(s => s.name), ['my-skill']);
});

test('conditions: case-insensitive, list fields, not_in; routing picks the first matching rule', async () => {
  const { conditionsMatch, routeWorkflow } = await import('@ot/contracts');
  const issue = { type: 'Bug', project: 'TC', labels: ['Frontend', 'p1'] };
  assert.ok(conditionsMatch([{ field: 'issue.type', op: 'in', values: ['bug'] }], { issue }));
  assert.ok(conditionsMatch([{ field: 'issue.labels', op: 'in', values: ['frontend'] }], { issue }));
  assert.ok(conditionsMatch([{ field: 'issue.project', op: 'not_in', values: ['SHOP'] }], { issue }));
  assert.ok(!conditionsMatch([{ field: 'classification.type', op: 'in', values: ['question'] }], { issue, classification: null }));
  assert.ok(conditionsMatch([{ field: 'classification.type', op: 'in', values: ['question'] }], { issue, classification: { type: 'question' } }));
  assert.ok(!conditionsMatch([], { issue }), 'no conditions never skips');
  const r = { default: 'default', rules: [{ name: 'shop', when: [{ field: 'issue.project' as const, op: 'in' as const, values: ['SHOP'] }], workflow: 'shop' }] };
  assert.equal(routeWorkflow(r, { project: 'SHOP' }), 'shop');
  assert.equal(routeWorkflow(r, { project: 'TC' }), 'default');
});

test('skip ports are validated', () => {
  const w = base();
  w.nodes[1] = { ...w.nodes[1]!, skipIf: [{ field: 'issue.type', op: 'in', values: ['x'] }], skipPort: 'pass' };
  assert.match(validateWorkflow(w).join(), /skip port "pass" does not exist/);
});
