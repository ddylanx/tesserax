import assert from 'node:assert/strict';
import { test } from 'node:test';
import { containsSecret, nodeConfigSchemas, projectSettingsSchema, roleConfigSchema, roleInScope, saveRoleSchema } from './index';

const ok = (v: unknown) => roleConfigSchema.safeParse(v).success;

test('role config: a valid sample is accepted with defaults', () => {
  const parsed = roleConfigSchema.parse({
    engine: 'claude', model: 'sonnet', executor: 'claude-cli', allowedTools: ['Read', 'Edit', 'Bash(git diff:*)'],
    mcp: { servers: ['docs'], tools: ['search'] }, maxBudgetUsd: 2, timeoutSeconds: 900,
  });
  assert.deepEqual(parsed.skills, []);
  assert.equal(parsed.engine, 'claude');
});

test('role config: unknown keys and permission/env/cli keys are rejected', () => {
  assert.equal(ok({ foo: 1 }), false);
  assert.equal(ok({ permissionMode: 'bypassPermissions' }), false);
  assert.equal(ok({ env: { A: 'b' } }), false);
  assert.equal(ok({ args: ['--dangerously-skip-permissions'] }), false);
  assert.equal(ok({ bin: '/bin/sh' }), false);
  assert.equal(ok({ mcp: { servers: [], definition: {} } }), false);
});

test('role config: only allow-listed tools', () => {
  assert.equal(ok({ allowedTools: ['Bash(*)'] }), false);
  assert.equal(ok({ allowedTools: ['Bash'] }), false);
  assert.equal(ok({ allowedTools: ['WebFetch'] }), false);
  assert.equal(ok({ allowedTools: ['Read', 'Bash(git commit:*)'] }), true);
});

test('role config: caps', () => {
  assert.equal(ok({ maxBudgetUsd: 20 }), true);
  assert.equal(ok({ maxBudgetUsd: 20.01 }), false);
  assert.equal(ok({ timeoutSeconds: 7201 }), false);
  assert.equal(ok({ skills: Array.from({ length: 21 }, (_, i) => `s${i}`) }), false);
  assert.equal(ok({ mcp: { servers: Array.from({ length: 21 }, (_, i) => `m${i}`) } }), false);
  assert.equal(ok({ engine: 'other' }), false);
  const role = { departmentId: '00000000-0000-4000-8000-000000000000', slug: 'dev', title: 'Dev' };
  assert.equal(saveRoleSchema.safeParse({ ...role, prompt: 'x'.repeat(20_000) }).success, true);
  assert.equal(saveRoleSchema.safeParse({ ...role, prompt: 'x'.repeat(20_001) }).success, false);
  assert.equal(saveRoleSchema.safeParse({ ...role, slug: 'Bad Slug' }).success, false);
  assert.equal(saveRoleSchema.safeParse({ ...role, slug: 'a'.repeat(41) }).success, false);
});

test('secrets are rejected in prompt and config', () => {
  for (const s of ['ghp_abcdefABCDEF123456', 'github_pat_11AAA', 'sk-ant-abcdefgh1234', 'xoxb-123', 'AKIAABCDEFGHIJKLMNOP', '-----BEGIN PRIVATE KEY-----']) {
    assert.equal(containsSecret(s), true, s);
  }
  assert.equal(containsSecret('Ask the DEMO team before a risky change.'), false);
  const role = { departmentId: '00000000-0000-4000-8000-000000000000', slug: 'dev', title: 'Dev' };
  assert.equal(saveRoleSchema.safeParse({ ...role, prompt: 'use token ghp_abcdefABCDEF123456' }).success, false);
  assert.equal(ok({ model: 'sk-ant-abcdefgh1234' }), false);
  assert.equal(ok({ mcp: { tools: ['AKIAABCDEFGHIJKLMNOP'] } }), false);
});

test('nodes can name a role; projects can limit roles', () => {
  const base = { prompt: 'p', output: 'x' };
  assert.equal(nodeConfigSchemas['ai.step'].parse({ ...base, role: 'engineering/backend-dev' }).role, 'engineering/backend-dev');
  assert.equal(nodeConfigSchemas['agent.run'].safeParse({ prompt: 'p', role: 'no-slash' }).success, false);
  const all = { settings: projectSettingsSchema.parse({}) };
  assert.equal(all.settings.roles, null);
  assert.equal(roleInScope(all, 'qa/reviewer'), true);
  const some = { settings: projectSettingsSchema.parse({ roles: ['qa/reviewer'] }) };
  assert.equal(roleInScope(some, 'qa/reviewer'), true);
  assert.equal(roleInScope(some, 'docs/tech-writer'), false);
});
