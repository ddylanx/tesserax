import assert from 'node:assert/strict';
import { test } from 'node:test';
import { allowedHosts, hostGuard } from './host-guard.middleware';

const config = { API_HOST: '127.0.0.1', API_PORT: 4400, WEB_PORT: 5180, WEB_BASE_URL: 'http://tesserax.local:5180' };

function call(host: string | undefined, c = config) {
  let status = 0;
  let passed = false;
  const res = { status: (s: number) => ((status = s), res), json: () => res } as never;
  hostGuard(allowedHosts(c))({ headers: host === undefined ? {} : { host } } as never, res, () => (passed = true));
  return passed ? 'next' : status;
}

test('loopback names pass on any port, whatever WEB_BASE_URL is', () => {
  for (const h of ['127.0.0.1:4400', '[::1]:4400', 'localhost:9999', 'LOCALHOST:4400', '127.0.0.1:5180', '127.0.0.1', 'localhost']) assert.equal(call(h), 'next', h);
  assert.equal(call('127.0.0.1:4400', { ...config, WEB_BASE_URL: 'http://tesserax.local:5180' }), 'next');
});

test('the WEB_BASE_URL host passes (case-insensitive)', () => {
  assert.equal(call('tesserax.local:5180'), 'next');
  assert.equal(call('Tesserax.Local:5180'), 'next');
});

test('other hosts are refused with 403', () => {
  for (const h of ['evil.test', 'evil.example:4400', 'tesserax.local:4400', 'tesserax.local:5180.evil', '127.0.0.1.evil.test:4400', 'localhost:4400@evil', '']) assert.equal(call(h), 403, h);
  assert.equal(call(undefined), 403);
});

test('a WEB_BASE_URL without a port also allows the bare name', () => {
  const hosts = allowedHosts({ ...config, WEB_BASE_URL: 'http://board.test' });
  assert.ok(hosts.has('board.test'));
  assert.ok(!allowedHosts({ ...config, WEB_BASE_URL: 'not a url' }).has('not a url'));
});
