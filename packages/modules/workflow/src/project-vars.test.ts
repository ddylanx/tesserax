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
