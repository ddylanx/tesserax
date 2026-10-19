import assert from 'node:assert/strict';
import { test } from 'node:test';
import { projectSettingsSchema, type Project } from '@tesserax/contracts';
import { findRuleConflict, matchPath, matchTask } from './match';

const project = (slug: string, position: number, rules: Partial<Project['settings']['rules']> = {}, isDefault = false): Project => ({
  id: slug, slug, name: slug, color: '#000000', kind: 'company', position, isDefault,
  settings: projectSettingsSchema.parse({ rules: { jiraKeys: [], sourceIds: [], repositories: [], ...rules } }),
});

test('matchTask picks the first project by position, by key, source or repository', () => {
  const ps = [project('b', 2, { jiraKeys: ['DEMO'] }), project('a', 1, { jiraKeys: ['DEMO', 'TC'] }), project('d', 3, { sourceIds: ['s1'] }, true), project('r', 4, { repositories: ['repo-x'] })];
  assert.equal(matchTask(ps, { project: 'DEMO', sourceId: 'x' }).slug, 'a');
  assert.equal(matchTask(ps, { project: null, sourceId: 's1' }).slug, 'd');
  assert.equal(matchTask(ps, { project: null, sourceId: 'x', repositoryId: 'repo-x' }).slug, 'r');
});

test('matchTask falls back to the default project', () => {
  const ps = [project('a', 1, { jiraKeys: ['TC'] }), project('d', 2, {}, true)];
  assert.equal(matchTask(ps, { project: 'ZZZ', sourceId: 'x' }).slug, 'd');
  assert.throws(() => matchTask([project('a', 1)], { project: null, sourceId: 'x' }), /default project/);
});

test('matchPath matches the folder and what is inside it, longest path first, never a sibling prefix', () => {
  const entries = [{ projectId: 'a', paths: ['/w/repo'] }, { projectId: 'b', paths: ['/w/repo/sub/', '/w/other'] }];
  assert.equal(matchPath(entries, '/w/repo'), 'a');
  assert.equal(matchPath(entries, '/w/repo/src/x'), 'a');
  assert.equal(matchPath(entries, '/w/repo/sub/deep'), 'b');
  assert.equal(matchPath(entries, '/w/repo2'), null);
  assert.equal(matchPath(entries, '/elsewhere'), null);
});

test('findRuleConflict names the other project', () => {
  const others = [project('a', 1, { jiraKeys: ['TC'], sourceIds: ['s1'] })];
  assert.match(findRuleConflict(others, project('x', 2, { jiraKeys: ['TC'] }).settings)!, /TC.*"a"/);
  assert.match(findRuleConflict(others, project('x', 2, { sourceIds: ['s1'] }).settings)!, /"a"/);
  assert.equal(findRuleConflict(others, project('x', 2, { jiraKeys: ['DEMO'] }).settings), null);
});

test('addWorkplaceToDefault links workplace to default project when workplaceIds is configured', async () => {
  let updatedSettings: any = null;
  const mockDb = {
    selectFrom: () => ({
      selectAll: () => ({
        where: () => ({
          executeTakeFirst: async () => ({
            id: 'proj-1',
            is_default: true,
            settings: { workplaceIds: ['existing-wp'] },
          }),
        }),
      }),
    }),
    updateTable: () => ({
      set: (val: any) => ({
        where: () => ({
          execute: async () => { updatedSettings = JSON.parse(val.settings); },
        }),
      }),
    }),
  } as any;

  const { ProjectsService } = await import('./projects.service');
  const service = new ProjectsService(mockDb, {} as any);
  await service.addWorkplaceToDefault('demo-app');

  assert.deepEqual(updatedSettings?.workplaceIds, ['existing-wp', 'demo-app']);
});

test('addWorkplaceToDefault does nothing when workplaceIds is empty (all workplaces allowed)', async () => {
  let updated = false;
  const mockDb = {
    selectFrom: () => ({
      selectAll: () => ({
        where: () => ({
          executeTakeFirst: async () => ({
            id: 'proj-1',
            is_default: true,
            settings: { workplaceIds: [] },
          }),
        }),
      }),
    }),
    updateTable: () => ({
      set: () => ({
        where: () => ({
          execute: async () => { updated = true; },
        }),
      }),
    }),
  } as any;

  const { ProjectsService } = await import('./projects.service');
  const service = new ProjectsService(mockDb, {} as any);
  await service.addWorkplaceToDefault('demo-app');

  assert.equal(updated, false);
});

