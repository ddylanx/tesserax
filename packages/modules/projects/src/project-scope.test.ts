import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mcpServerInScope, projectSettingsSchema, scopeRepoRegistry, skillInScope, workflowInScope } from '@tesserax/contracts';

const project = (slug: string, settings: Record<string, unknown> = {}) => ({ slug, settings: projectSettingsSchema.parse(settings) });

test('workflows and skills: null list shows all, a list shows only its entries, All shows all', () => {
  const open = project('open');
  const picky = project('picky', { workflows: ['bugfix'], skills: ['skills/review/SKILL.md'] });
  assert.equal(workflowInScope(open, 'default'), true);
  assert.equal(workflowInScope(picky, 'bugfix'), true);
  assert.equal(workflowInScope(picky, 'default'), false);
  assert.equal(workflowInScope(null, 'default'), true);
  assert.equal(skillInScope(picky, 'skills/review/SKILL.md'), true);
  assert.equal(skillInScope(picky, 'skills/other/SKILL.md'), false);
  assert.equal(skillInScope(open, 'skills/other/SKILL.md'), true);
});

test('repos: listed workplaces and the repositories holding them or named in the task rules', () => {
  const view = {
    repositories: [{ id: 'web' }, { id: 'api' }, { id: 'docs' }],
    workplaces: [{ id: 'web-a', repositoryId: 'web' }, { id: 'web-b', repositoryId: 'web' }, { id: 'api-a', repositoryId: 'api' }],
  };
  assert.deepEqual(scopeRepoRegistry(null, view), view);
  assert.deepEqual(scopeRepoRegistry(project('open'), view), view);
  const scoped = scopeRepoRegistry(project('p', { workplaceIds: ['web-b'], rules: { repositories: ['docs'] } }), view);
  assert.deepEqual(scoped.workplaces.map(w => w.id), ['web-b']);
  assert.deepEqual(scoped.repositories.map(r => r.id), ['web', 'docs']);
});

test('mcp: user-wide and own-folder servers show, another project folder is hidden, unclaimed folders show', () => {
  const a = project('a', { workplaceIds: ['wa'] });
  const b = project('b', { workplaceIds: ['wb'] });
  const open = project('open');
  const projects = [a, b, open];
  const workplaces = [{ id: 'wa', path: 'C:\\code\\alpha' }, { id: 'wb', path: '/home/me/beta/' }];
  const show = (p: typeof a | null, scope: string) => mcpServerInScope(p, projects, workplaces, { scope });
  assert.equal(show(a, 'user'), true);
  assert.equal(show(a, 'project:c:/code/alpha/sub'), true);
  assert.equal(show(a, 'local:/home/me/beta'), false);
  assert.equal(show(a, 'local:/home/me/betamax'), true);
  assert.equal(show(a, 'project:/tmp/elsewhere'), true);
  assert.equal(show(b, 'project:C:\\code\\alpha'), false);
  assert.equal(show(open, 'local:/home/me/beta'), true);
  assert.equal(show(null, 'local:/home/me/beta'), true);
});
