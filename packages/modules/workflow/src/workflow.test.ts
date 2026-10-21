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

  // Test source.kind and top-level labels
  assert.ok(conditionsMatch([{ field: 'source.kind', op: 'in', values: ['github'] }], { issue, source: { kind: 'GitHub' } }));
  assert.ok(conditionsMatch([{ field: 'source.kind', op: 'not_in', values: ['jira'] }], { issue, source: { kind: 'github' } }));
  assert.ok(conditionsMatch([{ field: 'labels', op: 'in', values: ['TESSERAX'] }], { issue, labels: ['tesserax', 'feature'] }));
  assert.ok(conditionsMatch([{ field: 'labels', op: 'not_in', values: ['blocked'] }], { issue, labels: ['tesserax'] }));

  const r = {
    default: 'default',
    rules: [
      { name: 'shop', when: [{ field: 'issue.project' as const, op: 'in' as const, values: ['SHOP'] }], workflow: 'shop' },
      { name: 'github-rule', when: [{ field: 'source.kind' as const, op: 'in' as const, values: ['github'] }], workflow: 'gh-flow' },
    ],
  };
  assert.equal(routeWorkflow(r, { project: 'SHOP' }), 'shop');
  assert.equal(routeWorkflow(r, { project: 'TC' }), 'default');
  assert.equal(routeWorkflow(r, { project: 'TC' }, { source: { kind: 'github' } }), 'gh-flow');
});

test('task.comment node validates and existing jira.comment workflows still validate', () => {
  const w1: WorkflowDefinition = {
    id: 'w1', name: 'W1', description: '',
    nodes: [
      { id: 't', type: 'trigger.jira', label: 'T', position: { x: 0, y: 0 }, config: {} },
      { id: 'c', type: 'task.comment', label: 'Comment', position: { x: 0, y: 0 }, config: { prompt: 'Write comment', output: 'task_comment' } },
    ],
    edges: [{ id: 'e1', source: 't', port: 'next', target: 'c' }],
  };
  assert.deepEqual(validateWorkflow(w1), []);

  const w2: WorkflowDefinition = {
    id: 'w2', name: 'W2', description: '',
    nodes: [
      { id: 't', type: 'trigger.jira', label: 'T', position: { x: 0, y: 0 }, config: {} },
      { id: 'c', type: 'jira.comment', label: 'Comment', position: { x: 0, y: 0 }, config: { prompt: 'Write comment', output: 'jira_comment' } },
    ],
    edges: [{ id: 'e1', source: 't', port: 'next', target: 'c' }],
  };
  assert.deepEqual(validateWorkflow(w2), []);
});

test('jiraComment executor skips on non-jira/non-github task', async () => {
  const { EXECUTORS } = await import('./executors');
  const commentExec = EXECUTORS['jira.comment']!;

  const localCtx = {
    task: { id: '1', source: 'local', key: 'L-1' },
    config: { output: 'task_comment' },
  } as any;

  const res = await commentExec(localCtx);
  assert.equal((res as any).port, 'skipped');
  assert.equal((res as any).output?.skipped, true);
});

test('WorkflowVcsService postTaskComment posts for GitHub and throws on unsupported source', async () => {
  const { WorkflowVcsService } = await import('./vcs.service');
  let postedToGithub: any = null;

  const mockTasks: any = {
    getTask: async (id: string) => ({
      id,
      source: 'github',
      project: 'owner/repo',
      key: '#123',
    }),
  };

  const vcs = new WorkflowVcsService(
    { GITHUB_TOKEN: 'fake-token', GITHUB_API_URL: 'https://api.github.com' } as any,
    {} as any,
    mockTasks,
  );

  // Mock global fetch
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    postedToGithub = { url: url.toString(), init };
    return Response.json({ id: 987 });
  }) as typeof fetch;

  try {
    const res = await vcs.postTaskComment({ task_id: 'gh-task' } as any, 'Comment from test');
    assert.deepEqual(res, { commentId: '987', issueKey: '#123' });
    assert.ok(postedToGithub.url.includes('/repos/owner/repo/issues/123/comments'));
    assert.equal(JSON.parse(postedToGithub.init.body).body, 'Comment from test');

    // Unsupported source throws
    mockTasks.getTask = async () => ({ id: 'local-task', source: 'local' });
    await assert.rejects(
      () => vcs.postTaskComment({ task_id: 'local-task' } as any, 'hello'),
      /Posting comments to local tasks is not supported/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
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

test('WorkflowEngine confirm posts task.comment once and second confirm fails (AC9)', async () => {
  const { WorkflowEngine } = await import('./engine.service');
  let postCount = 0;

  const nodeRun = {
    id: 'nr-1',
    run_id: 'run-1',
    node_id: 'c-1',
    node_type: 'task.comment',
    status: 'waiting',
    output: {},
  };

  const workflowSnapshot = {
    id: 'w-1',
    nodes: [
      { id: 'c-1', type: 'task.comment', config: { output: 'task_comment', prompt: 'test' } },
    ],
    edges: [],
  };

  const workflowRun = {
    id: 'run-1',
    task_id: 'gh-task-1',
    workflow_snapshot: workflowSnapshot,
  };

  const db: any = {
    selectFrom: (table: string) => {
      const q: any = {
        selectAll: () => q,
        where: () => q,
        orderBy: () => q,
        execute: async () => [nodeRun],
        executeTakeFirst: async () => (table === 'workflow_runs' ? workflowRun : (nodeRun.status === 'waiting' ? nodeRun : null)),
        executeTakeFirstOrThrow: async () => (table === 'workflow_runs' ? workflowRun : nodeRun),
      };
      return q;
    },
    updateTable: (table: string) => ({
      set: (updates: any) => {
        let conditionStatus = 'waiting';
        const uq: any = {
          where: (col: string, _op: string, val: any) => {
            if (col === 'status') conditionStatus = val;
            return uq;
          },
          executeTakeFirst: async () => {
            if (table === 'node_runs' && nodeRun.status === conditionStatus) {
              Object.assign(nodeRun, updates);
              return { numUpdatedRows: 1n };
            }
            return { numUpdatedRows: 0n };
          },
        };
        return uq;
      },
    }),
  };

  const vcs: any = {
    postTaskComment: async () => {
      postCount++;
      return { commentId: '99', issueKey: '#1' };
    },
  };

  const engine = new WorkflowEngine(
    db,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    vcs,
    {} as any,
  );

  // Mock internal helpers
  (engine as any).latestArtifact = async () => null;
  (engine as any).saveArtifact = async () => {};
  (engine as any).event = async () => {};
  (engine as any).complete = async (id: string, port: string, output: any) => {
    nodeRun.status = port; // 'posted'
  };

  // First confirm: posts successfully
  const res = await engine.confirm('run-1', { action: 'confirm', confirm: true, text: 'Hello' });
  assert.equal(postCount, 1);
  assert.deepEqual(res, { commentId: '99', issueKey: '#1' });
  assert.equal(nodeRun.status, 'posted');

  // Second confirm: node is no longer waiting, throws RunConflict and does not post again
  await assert.rejects(
    () => engine.confirm('run-1', { action: 'confirm', confirm: true, text: 'Hello again' }),
    /Nothing is waiting for you on this run|No step is currently waiting for input|This step is already being confirmed/,
  );
  assert.equal(postCount, 1, 'comment must not be posted a second time');
});

