import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { RepoRegistryStore, detectRepoStack, normalizeOrigin } from './store';

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

test('detectRepoStack identifies stack from repository manifest files', () => {
  const root = mkdtempSync(join(homedir(), '.ot-repos-stack-test-'));
  const store = new RepoRegistryStore(join(root, 'workplaces.json'), join(root, 'repos.json'));
  try {
    // 1. Node npm
    const nodeDir = join(root, 'node-npm');
    mkdirSync(nodeDir);
    writeFileSync(join(nodeDir, 'package.json'), JSON.stringify({ scripts: { test: 'node --test' } }));
    assert.deepEqual(detectRepoStack(nodeDir), {
      test_command: 'npm test',
      worktree_links: 'node_modules, .env',
    });

    // 2. Node pnpm workspace/monorepo with typecheck, lint, test
    const pnpmDir = join(root, 'node-pnpm');
    mkdirSync(pnpmDir);
    writeFileSync(join(pnpmDir, 'package.json'), JSON.stringify({ scripts: { test: 'vitest', lint: 'eslint .', typecheck: 'tsc --noEmit' } }));
    writeFileSync(join(pnpmDir, 'pnpm-lock.yaml'), '');
    assert.deepEqual(detectRepoStack(pnpmDir), {
      test_command: 'pnpm install --frozen-lockfile --prefer-offline && pnpm typecheck && pnpm lint && pnpm test',
      worktree_links: '.env',
    });

    // 3. Node yarn
    const yarnDir = join(root, 'node-yarn');
    mkdirSync(yarnDir);
    writeFileSync(join(yarnDir, 'package.json'), JSON.stringify({ scripts: { test: 'jest' } }));
    writeFileSync(join(yarnDir, 'yarn.lock'), '');
    assert.deepEqual(detectRepoStack(yarnDir), {
      test_command: 'yarn test',
      worktree_links: 'node_modules, .env',
    });

    // 4. PHP Composer
    const phpDir = join(root, 'php-app');
    mkdirSync(phpDir);
    writeFileSync(join(phpDir, 'composer.json'), JSON.stringify({ name: 'acme/app' }));
    assert.deepEqual(detectRepoStack(phpDir), {
      test_command: 'composer test',
      worktree_links: 'vendor, .env',
    });

    // 5. Python pyproject
    const pyDir = join(root, 'py-app');
    mkdirSync(pyDir);
    writeFileSync(join(pyDir, 'pyproject.toml'), '[project]\nname = "demo"');
    assert.deepEqual(detectRepoStack(pyDir), {
      test_command: 'pytest',
      worktree_links: '.venv, .env',
    });

    // 6. Go mod
    const goDir = join(root, 'go-app');
    mkdirSync(goDir);
    writeFileSync(join(goDir, 'go.mod'), 'module demo');
    assert.deepEqual(detectRepoStack(goDir), {
      test_command: 'go test ./...',
      worktree_links: '.env',
    });

    // 7. Node bun
    const bunDir = join(root, 'node-bun');
    mkdirSync(bunDir);
    writeFileSync(join(bunDir, 'package.json'), JSON.stringify({ scripts: { test: 'bun test', typecheck: 'tsc' } }));
    writeFileSync(join(bunDir, 'bun.lockb'), '');
    assert.deepEqual(detectRepoStack(bunDir), {
      test_command: 'bun run typecheck && bun test',
      worktree_links: 'node_modules, .env',
    });

    // 8. Hybrid Laravel + Vite project (package.json without test script + composer.json)
    const hybridDir = join(root, 'laravel-hybrid');
    mkdirSync(hybridDir);
    writeFileSync(join(hybridDir, 'package.json'), JSON.stringify({ scripts: { build: 'vite build', dev: 'vite' } }));
    writeFileSync(join(hybridDir, 'composer.json'), JSON.stringify({ name: 'laravel/app' }));
    assert.deepEqual(detectRepoStack(hybridDir), {
      test_command: 'composer test',
      worktree_links: 'vendor, .env',
    });

    // 9. store.inspect returns suggestedVars
    execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: nodeDir });
    const inspection = store.inspect(nodeDir);
    assert.deepEqual(inspection.suggestedVars, {
      test_command: 'npm test',
      worktree_links: 'node_modules, .env',
    });
  } finally {
    execFileSync('rm', ['-rf', root]);
  }
});
