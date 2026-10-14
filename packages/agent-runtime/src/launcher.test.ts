import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { diffInfo, ensureWorktree, checkBranch } from './git';
import { ALWAYS_DENIED, buildRunArgs } from './launcher';

test('run args always deny push/merge/remote changes, whatever the playbook allows', () => {
  const args = buildRunArgs({ sessionId: 's', permissionMode: 'acceptEdits', allowedTools: ['Edit', 'Bash(git push:*)'], maxBudgetUsd: 2 });
  const denied = args.slice(args.indexOf('--disallowedTools') + 1);
  for (const d of ['Bash(git push:*)', 'Bash(git merge:*)', 'Bash(git remote:*)', 'Bash(gh:*)']) assert.ok(denied.includes(d), d);
  assert.deepEqual(denied, ALWAYS_DENIED);
  assert.equal(args[args.indexOf('--max-budget-usd') + 1], '2');
  assert.ok(args.includes('--strict-mcp-config'));
});

test('branch names are checked', () => {
  assert.equal(checkBranch('tx/PAY-12'), 'tx/PAY-12');
  for (const bad of ['-x', 'a..b', 'a b', 'x.lock', 'tx/']) assert.throws(() => checkBranch(bad), bad);
});

test('worktree is created on its own branch, reused on re-run, and the main checkout is untouched', async () => {
  const root = mkdtempSync(join(tmpdir(), 'ot-git-'));
  const repo = join(root, 'repo');
  const g = (cwd: string, ...a: string[]) => execFileSync('git', a, { cwd, encoding: 'utf8' });
  execFileSync('mkdir', ['-p', repo]);
  g(repo, 'init', '-q', '-b', 'main');
  writeFileSync(join(repo, 'a.txt'), 'a\n');
  g(repo, 'add', '-A');
  g(repo, '-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'init');

  const wt = await ensureWorktree(repo, 'tx/T-1', join(root, 'data'));
  assert.equal(wt.created, true);
  assert.equal(g(wt.path, 'rev-parse', '--abbrev-ref', 'HEAD').trim(), 'tx/T-1');
  writeFileSync(join(wt.path, 'a.txt'), 'a\nb\n');
  writeFileSync(join(wt.path, 'new.txt'), 'n\n');
  const d = await diffInfo(wt.path, 'main');
  assert.equal(d.insertions, 1);
  assert.deepEqual(d.untracked, ['new.txt']);
  assert.equal(d.files, 2);
  assert.equal((await ensureWorktree(repo, 'tx/T-1', join(root, 'data'))).created, false);
  assert.equal(g(repo, 'status', '--porcelain'), '');
  assert.equal(g(repo, 'rev-parse', '--abbrev-ref', 'HEAD').trim(), 'main');
});

test('new issue branches start from the default branch, not the main checkout\'s current branch', async () => {
  const root = mkdtempSync(join(tmpdir(), 'ot-base-'));
  const repo = join(root, 'repo');
  const g = (cwd: string, ...a: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...a], { cwd, encoding: 'utf8' });
  execFileSync('mkdir', ['-p', repo]);
  g(repo, 'init', '-q', '-b', 'develop');
  writeFileSync(join(repo, 'a.txt'), 'a\n');
  g(repo, 'add', '-A');
  g(repo, 'commit', '-qm', 'init');
  const developSha = g(repo, 'rev-parse', 'HEAD').trim();
  g(repo, 'switch', '-qc', 'bugfix/someone-else');
  writeFileSync(join(repo, 'b.txt'), 'b\n');
  g(repo, 'add', '-A');
  g(repo, 'commit', '-qm', 'wip');
  const { resolveBaseRef } = await import('./git');
  assert.equal(await resolveBaseRef(repo, 'develop'), 'develop');
  await assert.rejects(resolveBaseRef(repo, 'nope'), /not found/);
  const wt = await ensureWorktree(repo, 'tx/T-2', join(root, 'data'), 'develop');
  assert.equal(g(wt.path, 'rev-parse', 'HEAD').trim(), developSha);
  assert.equal((await diffInfo(wt.path, 'develop')).files, 0);
  assert.equal(g(repo, 'rev-parse', '--abbrev-ref', 'HEAD').trim(), 'bugfix/someone-else');
});
