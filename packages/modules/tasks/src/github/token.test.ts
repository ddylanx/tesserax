import { strict as assert } from 'node:assert';
import { beforeEach, test } from 'node:test';
import { resolveGithubToken, _resetTokenCache } from './token';

beforeEach(() => {
  _resetTokenCache();
});

test('resolveGithubToken prefers GITHUB_TOKEN from config', async () => {
  let execCalled = false;
  const mockExec = async () => {
    execCalled = true;
    return { stdout: 'gh-token-value' };
  };

  const token = await resolveGithubToken({ GITHUB_TOKEN: 'env-token-value' }, mockExec as never);

  assert.equal(token, 'env-token-value');
  assert.equal(execCalled, false);
});

test('resolveGithubToken falls back to gh auth token when GITHUB_TOKEN is unset', async () => {
  let execArgs: any = null;
  const mockExec = async (file: string, args: string[]) => {
    execArgs = { file, args };
    return { stdout: 'gh-token-value\n' };
  };

  const token = await resolveGithubToken({ GITHUB_TOKEN: undefined }, mockExec as never);

  assert.equal(token, 'gh-token-value');
  assert.deepEqual(execArgs, { file: 'gh', args: ['auth', 'token'] });
});

test('resolveGithubToken returns null when gh is not installed (ENOENT)', async () => {
  const mockExec = async () => {
    const err: any = new Error('spawn gh ENOENT');
    err.code = 'ENOENT';
    throw err;
  };

  const token = await resolveGithubToken({ GITHUB_TOKEN: undefined }, mockExec as never);

  assert.equal(token, null);
});

test('resolveGithubToken returns null when gh command exits with non-zero or empty', async () => {
  const mockExec = async () => {
    return { stdout: '  \n' };
  };

  const token = await resolveGithubToken({ GITHUB_TOKEN: undefined }, mockExec as never);

  assert.equal(token, null);
});

test('resolveGithubToken does not cache null: subsequent successful gh login is resolved', async () => {
  let callCount = 0;
  const mockExec = async () => {
    callCount++;
    if (callCount === 1) {
      const err: any = new Error('not logged in');
      err.code = '1';
      throw err;
    }
    return { stdout: 'new-gh-token\n' };
  };

  const token1 = await resolveGithubToken({ GITHUB_TOKEN: undefined }, mockExec as never);
  assert.equal(token1, null);

  const token2 = await resolveGithubToken({ GITHUB_TOKEN: undefined }, mockExec as never);
  assert.equal(token2, 'new-gh-token');
});

test('resolveGithubToken config takes precedence dynamically even if gh was previously used', async () => {
  const mockExec = async () => ({ stdout: 'cached-gh-token\n' });

  const token1 = await resolveGithubToken({ GITHUB_TOKEN: undefined }, mockExec as never);
  assert.equal(token1, 'cached-gh-token');

  const token2 = await resolveGithubToken({ GITHUB_TOKEN: 'dynamic-override' }, mockExec as never);
  assert.equal(token2, 'dynamic-override');
});
