import { strict as assert } from 'node:assert';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { validateWorkflow, type TaskDetailDto, type WorkflowDefinition } from '@tesserax/contracts';
import { buildShellEnv, renderShellTemplate, renderTemplate, withSkills } from './render';
import { WorkflowStore } from './stores';
import { LocalSkillStore } from '@tesserax/mod-skills';

const root = join(__dirname, '../../../..');

test('the shipped default workflow is valid and its skills exist', () => {
  const workflowsDir = existsSync(join(root, 'workflows')) ? join(root, 'workflows') : join(root, 'examples', 'workflows');
  const { def, problems } = new WorkflowStore(workflowsDir).load('default');
  assert.deepEqual(problems, []);
  const skillsRoot = existsSync(join(root, 'skills')) ? root : join(root, 'examples');
  const skills = new LocalSkillStore(skillsRoot);
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

test('renderShellTemplate parameterizes shell commands into TX_* environment variables and buildShellEnv populates them', () => {
  const task = { id: 't1', key: 'PROJ-1', title: 'Fix bug; drop db', type: 'Bug', status: '', priority: '', labels: [], components: [], url: '', description: '', comments: [], attachments: [] } as unknown as TaskDetailDto;
  const ctx = {
    task,
    artifacts: {},
    repoPath: '/Users/test/my-repo; rm -rf /',
    branch: 'feat/$(whoami)`touch evil`"hack',
  };
  const rendered = renderShellTemplate('{{project.test_command}} && git checkout {{branch}}', ctx);
  assert.equal(rendered, '$TX_PROJECT_TEST_COMMAND && git checkout $TX_BRANCH');

  const env = buildShellEnv(ctx);
  assert.equal(env.TX_REPO_PATH, '/Users/test/my-repo; rm -rf /');
  assert.equal(env.TX_BRANCH, 'feat/$(whoami)`touch evil`"hack');
  assert.equal(env.TX_ISSUE_KEY, 'PROJ-1');
  assert.equal(env.TX_ISSUE_TITLE, 'Fix bug; drop db');
});

test('checkCommand throws FatalNodeError when project.test_command is missing or empty', async () => {
  const { EXECUTORS } = await import('./executors');
  const { FatalNodeError } = await import('./executors/types');
  const checkExecutor = EXECUTORS['check.command']!;

  const baseCtx = {
    config: { commands: ['{{project.test_command}}'], output: 'checks', timeoutSeconds: 30 },
    run: { id: 'r1', vars: { project: { name: 'MyProject', vars: {} } } },
    task: { id: 't1', key: 'TX-1', title: 'Test', project: 'MyProject', labels: [], components: [], comments: [], attachments: [] },
    projectVars: {},
    artifacts: {},
    feedback: null,
    engine: {
      ensureRunWorktree: async () => ({ worktree: '/tmp', repoPath: '/tmp', baseRef: 'origin/main', branch: 'tx/TX-1' }),
    },
    appConfig: {},
  };

  await assert.rejects(
    () => checkExecutor(baseCtx as any),
    (err: any) => err instanceof FatalNodeError && err.message === 'Project MyProject has no test_command; set it on the project page'
  );

  // When test_command is whitespace only
  const whitespaceCtx = {
    ...baseCtx,
    projectVars: { test_command: '   ' },
    run: { id: 'r1', vars: { project: { name: 'MyProject', vars: { test_command: '   ' } } } },
  };
  await assert.rejects(
    () => checkExecutor(whitespaceCtx as any),
    (err: any) => err instanceof FatalNodeError && err.message === 'Project MyProject has no test_command; set it on the project page'
  );

  // When test_command is configured and succeeds
  const validCtx = {
    ...baseCtx,
    projectVars: { test_command: 'echo "all tests pass"' },
    run: { id: 'r1', vars: { project: { name: 'MyProject', vars: { test_command: 'echo "all tests pass"' } } } },
  };
  const result = await checkExecutor(validCtx as any);
  assert.equal((result as any).port, 'pass');

  // When test_command has chained commands with &&
  const chainedCtx = {
    ...baseCtx,
    projectVars: { test_command: 'echo "step 1" && echo "step 2"' },
    run: { id: 'r1', vars: { project: { name: 'MyProject', vars: { test_command: 'echo "step 1" && echo "step 2"' } } } },
  };
  const chainedResult = await checkExecutor(chainedCtx as any);
  assert.equal((chainedResult as any).port, 'pass');
  assert.ok((chainedResult as any).artifact.content.includes('step 1'));
  assert.ok((chainedResult as any).artifact.content.includes('step 2'));

  // When command contains compound prefix before project.test_command, e.g. cd app && {{project.test_command}}
  const compoundCtx = {
    ...baseCtx,
    config: { commands: ['echo "prefix_preserved" && {{project.test_command}}'], output: 'checks', timeoutSeconds: 30 },
    projectVars: { test_command: 'echo "test_passed"' },
    run: { id: 'r1', vars: { project: { name: 'MyProject', vars: { test_command: 'echo "test_passed"' } } } },
  };
  const compoundResult = await checkExecutor(compoundCtx as any);
  assert.equal((compoundResult as any).port, 'pass');
  assert.ok((compoundResult as any).artifact.content.includes('prefix_preserved'));
  assert.ok((compoundResult as any).artifact.content.includes('test_passed'));
  assert.equal((compoundResult as any).output.results[0].command, 'echo "prefix_preserved" && $TX_PROJECT_TEST_COMMAND');

  // When first command in chained commands fails
  const failingChainedCtx = {
    ...baseCtx,
    projectVars: { test_command: 'exit 1 && echo "should not run"' },
    run: { id: 'r1', vars: { project: { name: 'MyProject', vars: { test_command: 'exit 1 && echo "should not run"' } } } },
  };
  const failingResult = await checkExecutor(failingChainedCtx as any);
  assert.equal((failingResult as any).port, 'fail');
});

test('workflow store finds workflows that reference a path', () => {
  const workflowsDir = existsSync(join(root, 'workflows')) ? join(root, 'workflows') : join(root, 'examples', 'workflows');
  const store = new WorkflowStore(workflowsDir);
  assert.ok(store.referencing('skills/write-spec/').length > 0);
  assert.deepEqual(store.referencing('skills/_packages/does-not-exist/'), []);
});

test('conditions: case-insensitive, list fields, not_in; routing picks the first matching rule', async () => {
  const { conditionsMatch, routeWorkflow } = await import('@tesserax/contracts');
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

test('WorkflowEngine resolves graph and nodes correctly', async () => {
  const { WorkflowEngine } = await import('./engine.service');
  const engine = new WorkflowEngine({} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any);
  const run = { workflow_snapshot: base() };
  assert.equal(engine.graph(run).id, 'x');
  assert.equal(engine.node(run, 't').type, 'trigger.jira');
  assert.throws(() => engine.node(run, 'non-existent'), /is not in this run's workflow/);
});

test('validates workflows with task.comment and alias jira.comment nodes', () => {
  const wTask: WorkflowDefinition = {
    id: 'wf-task', name: 'Workflow with task.comment', description: '',
    nodes: [
      { id: 't', type: 'trigger.jira', label: 'T', position: { x: 0, y: 0 }, config: {} },
      { id: 'c', type: 'task.comment', label: 'Comment', position: { x: 0, y: 0 }, config: { prompt: 'draft comment' } },
    ],
    edges: [{ id: 'e1', source: 't', port: 'next', target: 'c' }],
  };
  assert.deepEqual(validateWorkflow(wTask), []);

  const wJira: WorkflowDefinition = {
    id: 'wf-jira', name: 'Workflow with jira.comment alias', description: '',
    nodes: [
      { id: 't', type: 'trigger.jira', label: 'T', position: { x: 0, y: 0 }, config: {} },
      { id: 'c', type: 'jira.comment', label: 'Jira Comment', position: { x: 0, y: 0 }, config: { prompt: 'draft comment' } },
    ],
    edges: [{ id: 'e1', source: 't', port: 'next', target: 'c' }],
  };
  assert.deepEqual(validateWorkflow(wJira), []);

  // Both node types support 'posted' and 'skipped' ports
  const wPorts: WorkflowDefinition = {
    id: 'wf-ports', name: 'Workflow ports check', description: '',
    nodes: [
      { id: 't', type: 'trigger.jira', label: 'T', position: { x: 0, y: 0 }, config: {} },
      { id: 'tc', type: 'task.comment', label: 'TC', position: { x: 0, y: 0 }, config: { prompt: 'p' } },
      { id: 'jc', type: 'jira.comment', label: 'JC', position: { x: 0, y: 0 }, config: { prompt: 'p' } },
      { id: 'end1', type: 'evaluate', label: 'End1', position: { x: 0, y: 0 }, config: {} },
      { id: 'end2', type: 'evaluate', label: 'End2', position: { x: 0, y: 0 }, config: {} },
    ],
    edges: [
      { id: 'e1', source: 't', port: 'next', target: 'tc' },
      { id: 'e2', source: 'tc', port: 'posted', target: 'jc' },
      { id: 'e3', source: 'tc', port: 'skipped', target: 'end1' },
      { id: 'e4', source: 'jc', port: 'posted', target: 'end1' },
      { id: 'e5', source: 'jc', port: 'skipped', target: 'end2' },
    ],
  };
  assert.deepEqual(validateWorkflow(wPorts), []);
});

