import assert from 'node:assert/strict';
import { test } from 'node:test';
import { allowedHosts, hostGuard } from './host-guard.middleware';

const config = { API_HOST: '127.0.0.1', API_PORT: 4400, WEB_PORT: 5180, WEB_BASE_URL: 'http://tesserax.local:5180' };

function call(host: string | undefined) {
  let status = 0;
  let passed = false;
  const res = { status: (s: number) => ((status = s), res), json: () => res } as never;
  hostGuard(allowedHosts(config))({ headers: host === undefined ? {} : { host } } as never, res, () => (passed = true));
  return passed ? 'next' : status;
}

test('loopback, the web proxy host and WEB_BASE_URL pass', () => {
  for (const h of ['127.0.0.1:4400', 'localhost:4400', 'LOCALHOST:4400', '127.0.0.1:5180', 'localhost:5180', 'tesserax.local:5180', '[::1]:4400']) assert.equal(call(h), 'next', h);
});

test('other hosts are refused with 403', () => {
  for (const h of ['evil.example:4400', 'tesserax.local:4400.evil', '127.0.0.1', '127.0.0.1:9999', 'attacker.test', '']) assert.equal(call(h), 403, h);
  assert.equal(call(undefined), 403);
});

test('a WEB_BASE_URL without a port also allows the bare name', () => {
  const hosts = allowedHosts({ ...config, WEB_BASE_URL: 'http://board.test' });
  assert.ok(hosts.has('board.test'));
  assert.ok(!allowedHosts({ ...config, WEB_BASE_URL: 'not a url' }).has('not a url'));
});
