import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { projectSettingsSchema, type Project } from '@tesserax/contracts';
import type { TeamDepartmentRow, TeamRoleChangeRow, TeamRoleRow } from '@tesserax/db';
import type { TeamRepo } from './team.repo';
import { TeamService } from './team.service';

/** In-memory TeamRepo; a transaction works on a copy and keeps it only when fn succeeds. */
function memoryRepo() {
  let state = { departments: [] as TeamDepartmentRow[], roles: [] as TeamRoleRow[], changes: [] as TeamRoleChangeRow[] };
  const make = (s: typeof state): TeamRepo => ({
    departments: async () => [...s.departments].sort((a, b) => a.position - b.position),
    roles: async () => [...s.roles].sort((a, b) => a.position - b.position),
    insertDepartment: async v => {
      const row = { id: randomUUID(), created_at: new Date(), updated_at: new Date(), ...v };
      s.departments.push(row);
      return row;
    },
    updateDepartment: async (id, v) => {
      const row = s.departments.find(d => d.id === id);
      if (row) Object.assign(row, v);
      return row;
    },
    deleteDepartment: async id => {
      s.departments = s.departments.filter(d => d.id !== id);
    },
    insertRole: async v => {
      const row = { id: randomUUID(), created_at: new Date(), updated_at: new Date(), ...v };
      s.roles.push(row);
      return row;
    },
    updateRole: async (id, v) => {
      const row = s.roles.find(r => r.id === id);
      if (row) Object.assign(row, v);
      return row;
    },
    deleteRole: async id => {
      s.roles = s.roles.filter(r => r.id !== id);
    },
    addChange: async v => {
      s.changes.push({ id: randomUUID(), at: new Date(), ...v });
    },
    changes: async roleId => s.changes.filter(c => c.role_id === roleId).reverse(),
    transaction: async fn => {
      const copy = structuredClone(state);
      const result = await fn(make(copy));
      state = copy;
      return result;
    },
  });
  return { repo: new Proxy({} as TeamRepo, { get: (_t, k) => (make(state) as never)[k] }), state: () => state };
}

const project = (slug: string, roles: string[] | null): Project => ({
  id: slug, slug, name: slug, color: '#000000', kind: 'personal', position: 0, isDefault: false, settings: projectSettingsSchema.parse({ roles }),
});

function setup(used: Record<string, string[]> = {}) {
  const mem = memoryRepo();
  const projects = { get: async (slug: string) => ({ demo: project('demo', ['qa/reviewer']), open: project('open', null) })[slug] ?? null };
  const svc = new TeamService(mem.repo, { usedBy: key => used[key] ?? [] }, projects);
  return { svc, mem };
}

test('seed fills an empty team once', async () => {
  const { svc } = setup();
  assert.equal(await svc.seed(), true);
  assert.equal(await svc.seed(), false);
  const { departments, roles } = await svc.list();
  assert.deepEqual(departments.map(d => d.slug), ['engineering', 'qa', 'docs']);
  assert.deepEqual(roles.map(r => r.key).sort(), ['docs/tech-writer', 'engineering/backend-dev', 'qa/reviewer']);
  assert.ok(roles.every(r => r.problems.length === 0));
});

test('create, list, update a role; the hash follows prompt and config; every change is audited', async () => {
  const { svc, mem } = setup();
  const dept = await svc.createDepartment({ slug: 'engineering', name: 'Engineering' });
  const role = await svc.createRole({ departmentId: dept.id, slug: 'dev', title: 'Dev', prompt: 'Build it.', config: { engine: 'claude', allowedTools: ['Read'] } });
  assert.equal(role.key, 'engineering/dev');
  assert.match(role.hash, /^[0-9a-f]{12}$/);
  assert.equal((await svc.getByKey('engineering/dev'))?.id, role.id);
  assert.equal(await svc.getByKey('engineering/none'), null);

  const sameHash = await svc.updateRole(role.id, { title: 'Developer' });
  assert.equal(sameHash.title, 'Developer');
  assert.equal(sameHash.hash, role.hash);
  const changed = await svc.updateRole(role.id, { prompt: 'Build it well.' });
  assert.notEqual(changed.hash, role.hash);

  const changes = await svc.changes(role.id);
  assert.deepEqual(changes.map(c => c.action), ['update', 'update', 'create']);
  assert.equal(changes[0]!.oldHash, role.hash);
  assert.equal(changes[0]!.newHash, changed.hash);

  await svc.deleteRole(role.id);
  assert.equal(mem.state().roles.length, 0);
  assert.equal(mem.state().changes.at(-1)!.action, 'delete');
});

test('invalid configs are refused and nothing is written', async () => {
  const { svc, mem } = setup();
  const dept = await svc.createDepartment({ slug: 'qa', name: 'QA' });
  const base = { departmentId: dept.id, slug: 'r', title: 'R' };
  for (const config of [{ permissionMode: 'bypassPermissions' }, { allowedTools: ['Bash(*)'] }, { maxBudgetUsd: 100 }, { model: 'ghp_abcdefABCDEF123456' }]) {
    await assert.rejects(svc.createRole({ ...base, config }), (e: Error) => e.constructor.name === 'BadRequestException');
  }
  await assert.rejects(svc.createRole({ ...base, prompt: 'key: AKIAABCDEFGHIJKLMNOP' }), /BadRequest|token/);
  assert.equal(mem.state().roles.length, 0);
  assert.equal(mem.state().changes.length, 0);
});

test('a department with roles cannot be deleted; a used role cannot be renamed or deleted', async () => {
  const { svc } = setup({ 'qa/reviewer': ['default'] });
  const dept = await svc.createDepartment({ slug: 'qa', name: 'QA' });
  const role = await svc.createRole({ departmentId: dept.id, slug: 'reviewer', title: 'Reviewer' });
  assert.deepEqual(role.usedBy, ['default']);
  await assert.rejects(svc.deleteDepartment(dept.id), /roles first/);
  await assert.rejects(svc.updateRole(role.id, { slug: 'checker' }), /used by default/);
  await assert.rejects(svc.updateDepartment(dept.id, { slug: 'quality' }), /used by default/);
  await assert.rejects(svc.deleteRole(role.id), /used by default/);
  assert.equal((await svc.updateRole(role.id, { prompt: 'Look closer.' })).key, 'qa/reviewer');
  await assert.rejects(svc.createRole({ departmentId: dept.id, slug: 'reviewer', title: 'Again' }), /already exists/);
});

test('the project filter keeps only the roles a project allows', async () => {
  const { svc } = setup();
  await svc.seed();
  assert.deepEqual((await svc.list({ projectSlug: 'demo' })).roles.map(r => r.key), ['qa/reviewer']);
  assert.equal((await svc.list({ projectSlug: 'open' })).roles.length, 3);
  await assert.rejects(svc.list({ projectSlug: 'missing' }), /Project not found/);
});
