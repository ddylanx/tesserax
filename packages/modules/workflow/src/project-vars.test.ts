import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { TaskDetailDto } from '@tesserax/contracts';
import { buildShellEnv, renderShellTemplate, renderTemplate } from './render';

const task = { id: '1', key: 'TX-1', title: 'x', labels: [], components: [], comments: [], attachments: [] } as unknown as TaskDetailDto;
const ctx = { task, artifacts: {}, projectVars: { test_command: 'pnpm test' } };

test('{{project.<name>}} renders from the project variables; unknown ones stay as written', () => {
  assert.equal(renderTemplate('run {{project.test_command}} then {{project.nope}}', ctx), 'run pnpm test then {{project.nope}}');
});

test('shell steps read project variables from the environment, never from the command text', () => {
  assert.equal(renderShellTemplate('{{project.test_command}}', ctx), '$TX_PROJECT_TEST_COMMAND');
  assert.equal(renderShellTemplate('"{{project.test_command}}"', ctx), '"$TX_PROJECT_TEST_COMMAND"');
  assert.equal(buildShellEnv(ctx).TX_PROJECT_TEST_COMMAND, 'pnpm test');
});

test('check.command executes compound commands containing && via eval', async () => {
  const { EXECUTORS } = await import('./executors');
  const mockCtx = {
    config: { commands: ['{{project.test_command}}'], output: 'checks', timeoutSeconds: 5 },
    task,
    artifacts: {},
    feedback: null,
    projectVars: { test_command: 'echo step_one && echo step_two' },
    run: { branch: 'main', base_ref: 'main', worktree_path: process.cwd(), repo_path: process.cwd() },
    engine: {
      ensureRunWorktree: async () => ({ worktree: process.cwd(), created: false }),
    },
    appConfig: {},
  } as any;
  const res = (await EXECUTORS['check.command']!(mockCtx)) as { port?: string; artifact?: { content: string } };
  assert.equal(res.port, 'pass');
  assert.match(res.artifact!.content, /step_one/);
  assert.match(res.artifact!.content, /step_two/);
});

test('check.command preserves compound command prefix and does not drop it', async () => {
  const { EXECUTORS } = await import('./executors');
  const mockCtx = {
    config: { commands: ['echo prefix_ok && {{project.test_command}}'], output: 'checks', timeoutSeconds: 5 },
    task,
    artifacts: {},
    feedback: null,
    projectVars: { test_command: 'echo test_ran' },
    run: { branch: 'main', base_ref: 'main', worktree_path: process.cwd(), repo_path: process.cwd() },
    engine: {
      ensureRunWorktree: async () => ({ worktree: process.cwd(), created: false }),
    },
    appConfig: {},
  } as any;
  const res = (await EXECUTORS['check.command']!(mockCtx)) as {
    port?: string;
    artifact?: { content: string };
    output?: { results: { command: string }[] };
  };
  assert.equal(res.port, 'pass');
  assert.match(res.artifact!.content, /prefix_ok/);
  assert.match(res.artifact!.content, /test_ran/);
  assert.equal(res.output?.results[0]?.command, 'echo prefix_ok && $TX_PROJECT_TEST_COMMAND');
});
