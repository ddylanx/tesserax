import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { nodeConfigSchemas, projectSettingsSchema, type Role } from '@tesserax/contracts';
import type { Db } from '@tesserax/db';
import { McpService } from '@tesserax/mod-mcp';
import { applyRole, applyRunOverrides, resolveRole, runRoleLookup, snapshotRoles } from './apply-role';
import { FatalNodeError } from './executors/types';
import { withRole, withSkills } from './render';

const role = (over: Partial<Role> = {}): Role => ({
  id: 'r1', key: 'engineering/backend-dev', departmentId: 'd1', slug: 'backend-dev', title: 'Backend developer', enabled: true,
  prompt: 'Follow the conventions.', config: { engine: 'claude', model: 'sonnet', skills: ['skills/tdd/SKILL.md'], maxBudgetUsd: 3, timeoutSeconds: 1200 },
  position: 0, hash: 'abc123abc123', problems: [], usedBy: [], ...over,
});
const lookup = (r: Role | null) => ({ getByKey: async (key: string) => (r && r.key === key ? r : null), keys: async () => (r ? [r.key] : []) });
const step = (config: Record<string, unknown>) => ({ type: 'ai.step' as const, config: { prompt: 'Do it', output: 'analysis', role: 'engineering/backend-dev', ...config } });

test('the role fills what the node leaves unset; a field set in the node wins', async () => {
  const { config, role: applied } = await resolveRole(lookup(role()), step({}), null);
  const parsed = nodeConfigSchemas['ai.step'].parse(config);
  assert.equal(parsed.engine, 'claude');
  assert.equal(parsed.model, 'sonnet');
  assert.equal(parsed.maxBudgetUsd, 3);
  assert.equal(parsed.timeoutSeconds, 1200);
  assert.equal(applied?.hash, 'abc123abc123');

  const own = nodeConfigSchemas['ai.step'].parse((await resolveRole(lookup(role()), step({ model: 'opus', timeoutSeconds: 60 }), null)).config);
  assert.equal(own.model, 'opus');
  assert.equal(own.timeoutSeconds, 60);
  // a model belongs to its engine: a node on another engine does not get the role's model
  const other = nodeConfigSchemas['ai.step'].parse((await resolveRole(lookup(role()), step({ engine: 'gemini' }), null)).config);
  assert.equal(other.engine, 'gemini');
  assert.equal(other.model, undefined);
});

test('a run override wins over node and role', async () => {
  const config = nodeConfigSchemas['ai.step'].parse((await resolveRole(lookup(role()), step({}), null)).config) as Record<string, unknown>;
  applyRunOverrides(config, { id: 'n1', type: 'ai.step' }, { model: { n1: 'haiku' } });
  assert.equal(config.model, 'haiku');
  applyRunOverrides(config, { id: 'n1', type: 'ai.step' }, { engine: { n1: 'antigravity' } });
  assert.equal(config.engine, 'antigravity');
  assert.equal(config.model, undefined);
});

test('missing, disabled or project-blocked roles fail the step', async () => {
  await assert.rejects(resolveRole(lookup(null), step({}), null), (e: Error) => e instanceof FatalNodeError && /not found or disabled on the Team page/.test(e.message));
  await assert.rejects(resolveRole(lookup(role({ enabled: false })), step({}), null), /not found or disabled/);
  await assert.rejects(resolveRole(undefined, step({}), null), /not found or disabled/);
  const project = { name: 'DEMO', settings: projectSettingsSchema.parse({ roles: ['qa/reviewer'] }) };
  await assert.rejects(resolveRole(lookup(role()), step({}), project), (e: Error) => e instanceof FatalNodeError && /not enabled in project "DEMO"/.test(e.message));
  const open = { name: 'DEMO', settings: projectSettingsSchema.parse({ roles: ['engineering/backend-dev'] }) };
  assert.ok((await resolveRole(lookup(role()), step({}), open)).role);
  // no role named: the config is left as it is
  assert.deepEqual(await resolveRole(lookup(null), { type: 'ai.step', config: { prompt: 'x' } }, null), { config: { prompt: 'x' }, role: null });
});

test('tools: the role only narrows the node; a role row outside the allow-list fails', () => {
  const narrowed = applyRole({ allowedTools: ['Read', 'Edit'] }, role({ config: { allowedTools: ['Read'] } }), 'agent.run');
  assert.deepEqual(narrowed.config.allowedTools, ['Read']);
  const given = applyRole({}, role({ config: { allowedTools: ['Read', 'Grep'] } }), 'ai.step');
  assert.deepEqual(given.config.allowedTools, ['Read', 'Grep']);
  const kept = applyRole({ allowedTools: ['Read', 'Edit'] }, role({ config: {} }), 'agent.run');
  assert.deepEqual(kept.config.allowedTools, ['Read', 'Edit']);
  assert.throws(() => applyRole({}, role({ config: { allowedTools: ['Bash(*)'] } }), 'agent.run'), FatalNodeError);
  assert.throws(() => applyRole({}, role({ config: { permissionMode: 'bypassPermissions' } }), 'agent.run'), FatalNodeError);
  assert.throws(() => applyRole({}, role({ prompt: 'ghp_abcdefABCDEF123456' }), 'agent.run'), FatalNodeError);
});

test('agent.run takes the executor from the role unless the node sets one', () => {
  assert.equal(applyRole({ prompt: 'x' }, role({ config: { executor: 'gemini-cli' } }), 'agent.run').config.executor, 'gemini-cli');
  assert.equal(applyRole({ prompt: 'x', executor: 'ask' }, role({ config: { executor: 'gemini-cli' } }), 'agent.run').config.executor, 'ask');
  assert.equal(applyRole({ prompt: 'x' }, role({ config: { executor: 'gemini-cli' } }), 'ai.step').config.executor, undefined);
});

test('skills merged without duplicates; the role prompt comes first', () => {
  const { role: applied } = applyRole({}, role(), 'ai.review');
  const merged = [...new Set([...applied.skills, 'skills/tdd/SKILL.md', 'skills/review/SKILL.md'])];
  assert.deepEqual(merged, ['skills/tdd/SKILL.md', 'skills/review/SKILL.md']);
  const prompt = withRole(applied, withSkills('Task text', [{ name: 'tdd', body: 'Write tests first.' }]));
  assert.ok(prompt.startsWith('# Role: Backend developer\n\nFollow the conventions.'));
  assert.ok(prompt.indexOf('# Role:') < prompt.indexOf('# Skill: tdd'));
  assert.ok(prompt.indexOf('# Skill: tdd') < prompt.indexOf('Task text'));
  assert.equal(withRole({ title: 'Empty', prompt: '  ' }, 'Task text'), 'Task text');
});

test('a role asking for an MCP server only requests it: a server whose policy is off is not granted', async () => {
  const policies = [{ server: 'docs', mode: 'off', tools: '[]', engines: '["claude"]' }, { server: 'search', mode: 'all', tools: '[]', engines: '["claude"]' }];
  const db = {
    selectFrom: () => ({ selectAll: () => ({ where: (col: string, _op: string, val: string) => ({ execute: async () => policies.filter(p => (p as never)[col] !== val) }) }) }),
  } as unknown as Db;
  const provider = {
    name: 'mock', list: async () => [],
    listFull: async () => ['docs', 'search', 'other'].map(name => ({ id: name, name, client: 'Claude Code', scope: 'user', file: '', transport: 'stdio', target: name, enabled: true, envKeys: [], definition: { command: name } })),
  };
  const mcp = new McpService(db, provider as never);
  const { config } = applyRole({ prompt: 'x' }, role({ config: { mcp: { servers: ['docs'] } } }), 'ai.step');
  assert.deepEqual((await mcp.grantFor({ engine: 'claude', node: config as never, projectDirs: [] })).servers, []);
  const both = applyRole({ prompt: 'x' }, role({ config: { mcp: { servers: ['docs', 'search'] } } }), 'ai.step').config;
  assert.deepEqual((await mcp.grantFor({ engine: 'claude', node: both as never, projectDirs: [] })).servers.map(s => s.name), ['search']);
  // the node's own MCP request wins over the role's
  const own = applyRole({ prompt: 'x', mcp: { servers: [] } }, role({ config: { mcp: { servers: ['search'] } } }), 'ai.step').config;
  assert.deepEqual((await mcp.grantFor({ engine: 'claude', node: own as never, projectDirs: [] })).servers, []);
});

test('the role descriptor is told to the agent as a "## Your role" section after the role prompt', () => {
  const { role: applied } = applyRole({}, role({ config: { mission: 'Review DEMO changes.', notFor: ['Writing code'], reportLanguage: 'vi' } }), 'ai.review');
  assert.equal(applied.reportLanguage, 'vi');
  const prompt = withRole(applied, 'Task text');
  assert.ok(prompt.indexOf('Follow the conventions.') < prompt.indexOf('## Your role'));
  assert.ok(prompt.includes('Mission: Review DEMO changes.\nNot for:\n- Writing code'));
  assert.ok(prompt.indexOf('## Your role') < prompt.indexOf('Task text'));
  assert.equal(withRole({ title: 'Brief only', prompt: '', brief: '## Your role\nMission: x' }, 'T'), '# Role: Brief only\n\n## Your role\nMission: x\n\n---\n\nT');
});

test('a run uses the roles as they were when it started; older runs without a snapshot use the live rows', async () => {
  let current = role();
  const live = { getByKey: async (key: string) => (key === current.key ? current : null), keys: async () => [current.key] };
  const def = { nodes: [
    { id: 'plan', type: 'ai.step', config: { role: 'engineering/backend-dev' } },
    { id: 'build', type: 'agent.run', config: { role: 'engineering/backend-dev' } },
    { id: 'gate', type: 'human.gate', config: { role: 'ignored/here' } },
    { id: 'ghost', type: 'ai.step', config: { role: 'qa/ghost' } },
  ] } as never;
  const vars = { roles: await snapshotRoles(live, def) };
  assert.deepEqual(Object.keys(vars.roles), ['engineering/backend-dev']);

  const first = await resolveRole(runRoleLookup(vars, live), step({}), null);
  assert.equal(first.role?.hash, 'abc123abc123');
  // the role is edited on the Team page between the two nodes
  current = role({ prompt: 'New prompt.', hash: 'def456def456', config: { engine: 'gemini' } });
  const second = await resolveRole(runRoleLookup(vars, live), { type: 'agent.run', config: { prompt: 'x', role: 'engineering/backend-dev' } }, null);
  assert.equal(second.role?.hash, 'abc123abc123');
  assert.equal(second.role?.prompt, 'Follow the conventions.');
  // a new run takes the latest
  const fresh = { roles: await snapshotRoles(live, def) };
  assert.equal((await resolveRole(runRoleLookup(fresh, live), step({}), null)).role?.hash, 'def456def456');
  // a run started before snapshots existed reads the live row
  assert.equal((await resolveRole(runRoleLookup({ project: {} }, live), step({}), null)).role?.hash, 'def456def456');
  // a role missing when the run started stays missing
  await assert.rejects(resolveRole(runRoleLookup(vars, live), step({ role: 'qa/ghost' }), null), /not found or disabled/);
});
