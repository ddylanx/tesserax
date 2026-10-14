import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { LocalSkillStore } from './local-store';

test('skill store creates, reads and saves skills; rejects bad names and paths', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ot-skills-'));
  const store = new LocalSkillStore(dir);
  store.save('my-skill', '---\nname: my-skill\ndescription: d\n---\nBody', true);
  assert.throws(() => store.save('my-skill', 'x', true), /already exists/);
  assert.equal(store.get('skills/my-skill/SKILL.md').body, 'Body');
  const h1 = store.read('my-skill').hash;
  store.save('my-skill', '---\nname: my-skill\ndescription: d\n---\nBody 2');
  assert.notEqual(store.read('my-skill').hash, h1);
  assert.throws(() => store.pathOf('../etc'), /lowercase/);
  assert.throws(() => store.get('../../etc/passwd'), /outside skills\//);
  assert.deepEqual(store.list().map(s => s.name), ['my-skill']);
});

test('folded descriptions are read; packages are listed by the catalog', async () => {
  const { SkillCatalog } = await import('./catalog');
  const { SkillPackageStore } = await import('./package-store');
  const dir = mkdtempSync(join(tmpdir(), 'ot-skills-'));
  const local = new LocalSkillStore(dir);
  local.save('long', '---\nname: long\ndescription: >\n  One\n  two.\n---\nBody', true);
  assert.equal(local.get('skills/long/SKILL.md').description, 'One two.');
  mkdirSync(join(dir, 'skills/_packages/p/s'), { recursive: true });
  writeFileSync(join(dir, 'skills/_packages/p/s/SKILL.md'), '---\nname: s\ndescription: d\n---\nB');
  writeFileSync(join(dir, 'skills/packages.json'), JSON.stringify({ packages: [{ id: 'p', source: 'https://x/p.git', ref: null, commit: 'c', version: null, license: null, category: 'general', installedAt: '', updatedAt: '', skills: ['s'] }] }));
  const catalog = new SkillCatalog(local, new SkillPackageStore(dir));
  assert.deepEqual(catalog.list().map(s => s.path), ['skills/long/SKILL.md', 'skills/_packages/p/s/SKILL.md']);
  assert.equal(catalog.get('skills/_packages/p/s/SKILL.md').body, 'B');
});
