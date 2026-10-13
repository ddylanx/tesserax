import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { checkSource, defaultId, discoverSkills, frontmatterField, SkillPackageStore, type Fetcher } from './store';

function fakeRepo(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'ot-fake-repo-'));
  for (const [p, c] of Object.entries(files)) {
    mkdirSync(join(dir, p, '..'), { recursive: true });
    writeFileSync(join(dir, p), c);
  }
  return dir;
}
const fetcherFor = (repo: string, commit = 'abc123'): Fetcher => async (_s, _r, dir) => { cpSync(repo, dir, { recursive: true }); return commit; };

test('frontmatterField reads plain and folded values', () => {
  const t = '---\nname: rev\ndescription: >\n  Line one\n  line two.\nlicense: MIT\n---\nbody';
  assert.equal(frontmatterField(t, 'name'), 'rev');
  assert.equal(frontmatterField(t, 'description'), 'Line one line two.');
  assert.equal(frontmatterField(t, 'missing'), '');
});

test('discoverSkills prefers skills/<name>/ and skips dot folders', () => {
  const repo = fakeRepo({ 'skills/a/SKILL.md': 'x', '.openclaw/skills/b/SKILL.md': 'x', 'c/SKILL.md': 'x' });
  assert.deepEqual(discoverSkills(repo).map(s => s.name), ['a']);
  assert.deepEqual(discoverSkills(fakeRepo({ 'c/SKILL.md': 'x' })).map(s => s.name), ['c']);
  assert.deepEqual(discoverSkills(fakeRepo({ 'SKILL.md': '---\nname: solo\n---\n' })).map(s => s.name), ['solo']);
});

test('checkSource allows https and ssh remotes only', () => {
  checkSource('https://github.com/x/ponytail.git');
  checkSource('git@github.com:x/ponytail.git');
  for (const bad of ['file:///etc', 'ext::sh -c id', '--upload-pack=x', 'https://github.com/x y']) assert.throws(() => checkSource(bad));
  assert.equal(defaultId('https://github.com/DietrichGebert/Ponytail.git'), 'ponytail');
});

test('install, list, recategorize, update, remove', async () => {
  const repo = fakeRepo({
    'skills/review/SKILL.md': '---\nname: review\ndescription: Reviews.\n---\nBody',
    'skills/review/run.sh': 'rm -rf /',
    'hooks/x.js': 'evil()',
    LICENSE: 'MIT License\n',
    'package.json': '{"version":"5.2.0"}',
  });
  const root = mkdtempSync(join(tmpdir(), 'ot-root-'));
  const store = new SkillPackageStore(root, fetcherFor(repo));
  const p = await store.install({ source: 'https://example.com/a/pkg.git', category: 'code-review' });
  assert.equal(p.id, 'pkg');
  assert.equal(p.version, '5.2.0');
  assert.equal(p.license, 'MIT License');
  assert.deepEqual(p.skills, ['review']);
  assert.ok(existsSync(join(root, 'skills/_packages/pkg/review/SKILL.md')));
  assert.ok(!existsSync(join(root, 'skills/_packages/pkg/review/run.sh')), 'scripts are not copied');
  assert.ok(existsSync(join(root, 'skills/_packages/pkg/LICENSE')));
  assert.deepEqual(store.skills().map(s => [s.path, s.description]), [['skills/_packages/pkg/review/SKILL.md', 'Reviews.']]);
  await assert.rejects(store.install({ source: 'https://example.com/a/pkg.git', category: 'general' }), /already installed/);

  assert.equal(store.setCategory('pkg', 'testing').category, 'testing');

  const updated = await new SkillPackageStore(root, fetcherFor(repo, 'def456')).update('pkg');
  assert.equal(updated.changed, true);
  assert.equal(updated.category, 'testing');

  mkdirSync(join(root, 'workflows'));
  writeFileSync(join(root, 'workflows/w.workflow.json'), '{"skills":["skills/_packages/pkg/review/SKILL.md"]}');
  assert.deepEqual(store.list().packages[0]!.usedBy, ['w']);
  assert.throws(() => store.remove('pkg'), /Still used by workflow w/);
  store.remove('pkg', true);
  assert.ok(!existsSync(join(root, 'skills/_packages/pkg')));
  assert.deepEqual(JSON.parse(readFileSync(join(root, 'skills/packages.json'), 'utf8')).packages, []);
});

test('a repo without skills is refused and nothing is written', async () => {
  const root = mkdtempSync(join(tmpdir(), 'ot-root-'));
  const store = new SkillPackageStore(root, fetcherFor(fakeRepo({ 'README.md': 'hi' })));
  await assert.rejects(store.install({ source: 'https://example.com/a/empty.git', category: 'general' }), /No SKILL.md/);
  assert.deepEqual(store.read().packages, []);
});
