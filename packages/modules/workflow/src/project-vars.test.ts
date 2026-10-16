import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { TaskDetailDto } from '@tesserax/contracts';
import { renderTemplate } from './render';

const task = { id: '1', key: 'TX-1', title: 'x', labels: [], components: [], comments: [], attachments: [] } as unknown as TaskDetailDto;

test('{{project.<name>}} renders from the project variables; unknown ones stay as written', () => {
  const ctx = { task, artifacts: {}, projectVars: { test_command: 'pnpm test' } };
  assert.equal(renderTemplate('run {{project.test_command}} then {{project.nope}}', ctx), 'run pnpm test then {{project.nope}}');
});
