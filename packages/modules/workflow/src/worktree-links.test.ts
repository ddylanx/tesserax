import assert from 'node:assert/strict';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { FatalNodeError } from './executors/types';
import { ensureWorktreeLinks, parseWorktreeLinks } from './worktree-links';

test('parseWorktreeLinks handles null, undefined, whitespace, commas and newlines', () => {
  assert.deepEqual(parseWorktreeLinks(null), []);
  assert.deepEqual(parseWorktreeLinks(undefined), []);
  assert.deepEqual(parseWorktreeLinks(''), []);
  assert.deepEqual(parseWorktreeLinks('   '), []);
  assert.deepEqual(parseWorktreeLinks('node_modules, .env'), ['node_modules', '.env']);
  assert.deepEqual(parseWorktreeLinks('vendor\n.env\tstorage'), ['vendor', '.env', 'storage']);
  assert.deepEqual(parseWorktreeLinks('  node_modules,  .env , , package.json \n'), ['node_modules', '.env', 'package.json']);
});

test('ensureWorktreeLinks creates symlinks for files and directories idempotently', () => {
  const root = mkdtempSync(join(tmpdir(), 'wt-links-test-'));
  try {
    const repo = join(root, 'repo');
    const wt = join(root, 'wt');
    mkdirSync(repo, { recursive: true });
    mkdirSync(wt, { recursive: true });

    // create source files and directories
    mkdirSync(join(repo, 'node_modules'));
    writeFileSync(join(repo, 'node_modules', 'dep.txt'), 'some-dep');
    writeFileSync(join(repo, '.env'), 'SECRET=123');

    ensureWorktreeLinks({
      repoPath: repo,
      worktreePath: wt,
      linksRaw: 'node_modules, .env',
    });

    const nmStat = lstatSync(join(wt, 'node_modules'));
    assert.ok(nmStat.isSymbolicLink(), 'node_modules should be a symlink');
    assert.equal(readFileSync(join(wt, 'node_modules', 'dep.txt'), 'utf8'), 'some-dep');

    const envStat = lstatSync(join(wt, '.env'));
    assert.ok(envStat.isSymbolicLink(), '.env should be a symlink');
    assert.equal(readFileSync(join(wt, '.env'), 'utf8'), 'SECRET=123');

    // Run a second time to ensure idempotency
    ensureWorktreeLinks({
      repoPath: repo,
      worktreePath: wt,
      linksRaw: 'node_modules, .env',
    });
    assert.ok(lstatSync(join(wt, 'node_modules')).isSymbolicLink());
    assert.ok(lstatSync(join(wt, '.env')).isSymbolicLink());
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('ensureWorktreeLinks recovers from dangling or outdated symlinks', () => {
  const root = mkdtempSync(join(tmpdir(), 'wt-links-test-'));
  try {
    const repo = join(root, 'repo');
    const wt = join(root, 'wt');
    const wrong = join(root, 'wrong');
    mkdirSync(repo, { recursive: true });
    mkdirSync(wt, { recursive: true });
    mkdirSync(wrong, { recursive: true });

    writeFileSync(join(repo, '.env'), 'NEW_ENV=1');
    writeFileSync(join(wrong, '.env'), 'OLD_ENV=1');

    // pre-create wrong symlink in worktree
    symlinkSync(join(wrong, '.env'), join(wt, '.env'));
    assert.equal(readFileSync(join(wt, '.env'), 'utf8'), 'OLD_ENV=1');

    ensureWorktreeLinks({
      repoPath: repo,
      worktreePath: wt,
      linksRaw: '.env',
    });

    assert.equal(readFileSync(join(wt, '.env'), 'utf8'), 'NEW_ENV=1');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('ensureWorktreeLinks does not overwrite real existing files or directories', () => {
  const root = mkdtempSync(join(tmpdir(), 'wt-links-test-'));
  try {
    const repo = join(root, 'repo');
    const wt = join(root, 'wt');
    mkdirSync(repo, { recursive: true });
    mkdirSync(wt, { recursive: true });

    writeFileSync(join(repo, '.env'), 'REPO_ENV');
    writeFileSync(join(wt, '.env'), 'WT_ORIGINAL');

    const warnings: string[] = [];
    ensureWorktreeLinks({
      repoPath: repo,
      worktreePath: wt,
      linksRaw: '.env',
      logger: { warn: (msg: string) => warnings.push(msg) },
    });

    // .env in wt should still be regular file and not overwritten
    const stat = lstatSync(join(wt, '.env'));
    assert.ok(!stat.isSymbolicLink());
    assert.equal(readFileSync(join(wt, '.env'), 'utf8'), 'WT_ORIGINAL');
    assert.ok(warnings.some(w => w.includes('already exists and is not a symlink')));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('ensureWorktreeLinks safely skips non-existent sources with warning', () => {
  const root = mkdtempSync(join(tmpdir(), 'wt-links-test-'));
  try {
    const repo = join(root, 'repo');
    const wt = join(root, 'wt');
    mkdirSync(repo, { recursive: true });
    mkdirSync(wt, { recursive: true });

    const warnings: string[] = [];
    ensureWorktreeLinks({
      repoPath: repo,
      worktreePath: wt,
      linksRaw: 'missing_dir, .env',
      logger: { warn: (msg: string) => warnings.push(msg) },
    });

    assert.ok(!existsSync(join(wt, 'missing_dir')));
    assert.ok(warnings.some(w => w.includes('Source link does not exist, skipping')));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('ensureWorktreeLinks rejects path traversal, absolute paths and null bytes', () => {
  const root = mkdtempSync(join(tmpdir(), 'wt-links-test-'));
  try {
    const repo = join(root, 'repo');
    const wt = join(root, 'wt');
    mkdirSync(repo, { recursive: true });
    mkdirSync(wt, { recursive: true });

    assert.throws(
      () => ensureWorktreeLinks({ repoPath: repo, worktreePath: wt, linksRaw: '../../secret' }),
      (err: any) => err instanceof FatalNodeError && err.message.includes('Invalid worktree_links entry "../../secret"') && /fix it on the project page/i.test(err.message)
    );

    assert.throws(
      () => ensureWorktreeLinks({ repoPath: repo, worktreePath: wt, linksRaw: '/etc/passwd' }),
      (err: any) => err instanceof FatalNodeError && err.message.includes('Invalid worktree_links entry "/etc/passwd"') && /fix it on the project page/i.test(err.message)
    );

    assert.throws(
      () => ensureWorktreeLinks({ repoPath: repo, worktreePath: wt, linksRaw: 'foo\0bar' }),
      (err: any) => err instanceof FatalNodeError && err.message.includes('Invalid worktree_links entry') && /fix it on the project page/i.test(err.message)
    );

    assert.throws(
      () => ensureWorktreeLinks({ repoPath: repo, worktreePath: wt, linksRaw: '.' }),
      (err: any) => err instanceof FatalNodeError && err.message.includes('Invalid worktree_links entry "."')
    );

    assert.throws(
      () => ensureWorktreeLinks({ repoPath: repo, worktreePath: wt, linksRaw: './' }),
      (err: any) => err instanceof FatalNodeError && err.message.includes('Invalid worktree_links entry "./"')
    );

    assert.throws(
      () => ensureWorktreeLinks({ repoPath: repo, worktreePath: wt, linksRaw: '..' }),
      (err: any) => err instanceof FatalNodeError && err.message.includes('Invalid worktree_links entry ".."')
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('ensureWorktreeLinks handles paths with trailing slashes correctly', () => {
  const root = mkdtempSync(join(tmpdir(), 'wt-links-test-'));
  try {
    const repo = join(root, 'repo');
    const wt = join(root, 'wt');
    mkdirSync(repo, { recursive: true });
    mkdirSync(wt, { recursive: true });

    mkdirSync(join(repo, 'storage'));
    writeFileSync(join(repo, 'storage', 'data.log'), 'logs');

    ensureWorktreeLinks({
      repoPath: repo,
      worktreePath: wt,
      linksRaw: 'storage/',
    });

    const stat = lstatSync(join(wt, 'storage'));
    assert.ok(stat.isSymbolicLink());
    assert.equal(readFileSync(join(wt, 'storage', 'data.log'), 'utf8'), 'logs');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
