import assert from 'node:assert/strict';
import { test } from 'node:test';
import { defaultOnPath, detectEnvironment } from './system.controller';

test('detectEnvironment: Case 1 - Postgres ok, git on PATH, claude binary and ~/.claude.json exist', () => {
  const env = detectEnvironment('ok', {
    home: '/mock/home',
    path: '/usr/bin:/bin',
    onPath: (bin: string) => bin === 'git' || bin === 'claude',
    fileExists: (path: string) => path === '/mock/home/.claude.json',
  });

  assert.equal(env.postgres, 'ok');
  assert.equal(env.git, true);
  assert.equal(env.ready, true);

  const claude = env.agents.find(a => a.id === 'claude')!;
  assert.equal(claude.installed, true);
  assert.equal(claude.signedIn, 'yes');

  const gemini = env.agents.find(a => a.id === 'gemini')!;
  assert.equal(gemini.installed, false);
  assert.equal(gemini.signedIn, 'no');

  const antigravity = env.agents.find(a => a.id === 'antigravity')!;
  assert.equal(antigravity.installed, false);
  assert.equal(antigravity.signedIn, 'no');
});

test('detectEnvironment: Case 2 - Postgres ok, git on PATH, gemini binary but no credential file', () => {
  const env = detectEnvironment('ok', {
    home: '/mock/home',
    path: '/usr/bin:/bin',
    onPath: (bin: string) => bin === 'git' || bin === 'gemini',
    fileExists: () => false,
  });

  assert.equal(env.postgres, 'ok');
  assert.equal(env.git, true);
  assert.equal(env.ready, true);

  const gemini = env.agents.find(a => a.id === 'gemini')!;
  assert.equal(gemini.installed, true);
  assert.equal(gemini.signedIn, 'unknown');
  assert.equal(gemini.signInCommand, 'gemini');

  const claude = env.agents.find(a => a.id === 'claude')!;
  assert.equal(claude.installed, false);
  assert.equal(claude.signedIn, 'no');
});

test('detectEnvironment: Case 3 - Postgres ok, git on PATH, but no agent binary on PATH', () => {
  const env = detectEnvironment('ok', {
    home: '/mock/home',
    path: '/usr/bin:/bin',
    onPath: (bin: string) => bin === 'git',
    fileExists: () => false,
  });

  assert.equal(env.postgres, 'ok');
  assert.equal(env.git, true);
  assert.equal(env.ready, false);
  assert.ok(env.agents.every(a => !a.installed));
});

test('detectEnvironment: edge cases - postgres down or git missing', () => {
  const downEnv = detectEnvironment('down', {
    home: '/mock/home',
    onPath: () => true,
    fileExists: () => true,
  });
  assert.equal(downEnv.postgres, 'down');
  assert.equal(downEnv.ready, false);

  const noGitEnv = detectEnvironment('ok', {
    home: '/mock/home',
    onPath: (bin: string) => bin === 'claude',
    fileExists: () => false,
  });
  assert.equal(noGitEnv.git, false);
  assert.equal(noGitEnv.ready, false);
});

test('defaultOnPath handles empty/undefined PATH gracefully', () => {
  assert.equal(defaultOnPath('git', ''), false);
});
