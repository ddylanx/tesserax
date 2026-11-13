import assert from 'node:assert/strict';
import { test } from 'node:test';
import { groupByWorkType, projectSettingsSchema } from './index';

test('work type: groups keep project order, projects without one go last', () => {
  const p = (slug: string, workType?: string) => ({ slug, settings: { workType } });
  const groups = groupByWorkType([p('a'), p('b', 'dev'), p('c', 'business'), p('d', 'dev')]);
  assert.deepEqual(groups.map(([t, l]) => [t, l.map(x => x.slug)]), [['dev', ['b', 'd']], ['business', ['c']], ['other', ['a']]]);
});

test('work type: lowercase slug only', () => {
  assert.equal(projectSettingsSchema.safeParse({ workType: 'dev' }).success, true);
  assert.equal(projectSettingsSchema.safeParse({ workType: 'Dev Team' }).success, false);
});
