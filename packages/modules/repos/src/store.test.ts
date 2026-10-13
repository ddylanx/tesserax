import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { RepoRegistryStore, normalizeOrigin } from './store';

// checkouts must live in the home folder (same rule as the app), so the fixtures go there
const sandbox = () => {
  const root = mkdtempSync(join(homedir(), '.ot-repos-test-'));
  const checkout = (name: string, origin: string) => {
    const dir = join(root, name);
    mkdirSync(dir);
    execFileSync('git', ['init', '-q', '-b', 'develop'], { cwd: dir });
    execFileSync('git', ['remote', 'add', 'origin', origin], { cwd: dir });
    return dir;
  };
  return { root, checkout, store: new RepoRegistryStore(join(root, 'workplaces.json'), join(root, 'repos.json')) };
};

test('origins compare across ssh and https spellings', () => {
  assert.equal(normalizeOrigin('git@bitbucket.org:Acme/Shop-Core.git'), normalizeOrigin('https://user@bitbucket.org/acme/shop-core'));
  assert.notEqual(normalizeOrigin('git@bitbucket.org:acme/a.git'), normalizeOrigin('git@bitbucket.org:acme/b.git'));
});

test('legacy config/repos.json becomes one repository with a workplace per project', async t => {
  const { root, checkout, store } = sandbox();
  t.after(() => execFileSync('rm', ['-rf', root]));
  const a = checkout('core-a', 'git@bitbucket.org:acme/core.git');
  const b = checkout('core-b', 'https://bitbucket.org/acme/core');
  writeFileSync(join(root, 'repos.json'), JSON.stringify({ SHOP: { path: a, base: 'develop' }, TC: b }));
  const reg = store.read();
  assert.equal(reg.repositories.length, 1, 'same origin = same repository');
  assert.deepEqual(reg.workplaces.map(w => [w.brand, w.projects]), [['SHOP', ['SHOP']], ['TC', ['TC']]]);
  assert.ok(JSON.parse(readFileSync(store.file, 'utf8')).workplaces.length === 2, 'saved');
  assert.equal(store.resolve({ project: 'TC' })?.path, b);
});

test('a task resolves to its picked workplace, else the one for its project; status checks the origin', async t => {
  const { root, checkout, store } = sandbox();
  t.after(() => execFileSync('rm', ['-rf', root]));
  const main = checkout('shop', 'git@bitbucket.org:acme/shop-core.git');
  const brand2 = checkout('shop-brand2', 'git@bitbucket.org:acme/shop-core.git');
  const other = checkout('other', 'git@bitbucket.org:acme/other.git');
  store.saveRepository({ id: 'shop-core', name: 'shop-core', origin: 'https://bitbucket.org/acme/shop-core.git', base: 'develop' });
  store.saveWorkplace({ id: 'shop', repositoryId: 'shop-core', brand: 'ShopBrand', path: main, projects: ['SHOP'] });
  store.saveWorkplace({ id: 'brand2', repositoryId: 'shop-core', brand: 'Brand 2', path: brand2, base: 'release' });
  store.saveWorkplace({ id: 'wrong', repositoryId: 'shop-core', brand: 'Wrong', path: other });

  assert.equal(store.resolve({ project: 'SHOP' })?.brand, 'ShopBrand');
  const picked = store.resolve({ project: 'SHOP', workplaceId: 'brand2' })!;
  assert.deepEqual([picked.brand, picked.path, picked.base, picked.repositoryName], ['Brand 2', brand2, 'release', 'shop-core']);
  assert.equal(store.resolve({ project: 'NOPE' }), null);

  const reg = store.read();
  assert.equal(store.status(reg.workplaces[0]!, reg.repositories[0]).originMatches, true);
  assert.equal(store.status(reg.workplaces[2]!, reg.repositories[0]).originMatches, false);
  assert.equal(store.inspect(brand2).repositoryId, 'shop-core');

  assert.throws(() => store.deleteRepository('shop-core'), /workplaces first/);
  assert.throws(() => store.saveWorkplace({ id: 'x', repositoryId: 'shop-core', brand: 'X', path: '/tmp' }), /home folder/);
  assert.throws(() => store.saveWorkplace({ id: 'y', repositoryId: 'nope', brand: 'Y', path: main }), /Unknown repository/);
});
