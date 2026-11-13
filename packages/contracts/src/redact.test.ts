import assert from 'node:assert/strict';
import { test } from 'node:test';
import { containsSecret, redact } from './index';

const env = {
  TELEGRAM_BOT_TOKEN: '123456789:demo-telegram-token-value',
  DATABASE_URL: 'postgres://demo:demo-password@127.0.0.1:54329/tesserax',
  API_KEY: 'short', // too short to be treated as a secret value
  HOME: '/home/demo-user-with-a-long-path',
};

test('secret env values and token-shaped strings are masked', () => {
  const text = `connect ${env.DATABASE_URL} then use ${env.TELEGRAM_BOT_TOKEN}; gh ghp_abcdefABCDEF1234567890 aws AKIAABCDEFGHIJKLMNOP`;
  const out = redact(text, env);
  assert.equal(out, 'connect «redacted:DATABASE_URL» then use «redacted:TELEGRAM_BOT_TOKEN»; gh «redacted:token» aws «redacted:token»');
  assert.equal(redact('-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\nafter'), '«redacted:token»\nafter');
  assert.equal(redact('key sk-ant-abcdefgh1234 and xoxb-123-456'), 'key «redacted:token» and «redacted:token»');
});

test('normal text is unchanged (short values and non-secret keys are kept)', () => {
  const text = 'Build passed in /home/demo-user-with-a-long-path; short value; task-12 risk-low.';
  assert.equal(redact(text, env), text);
  assert.equal(redact('', env), '');
});

test('containsSecret uses the same patterns', () => {
  assert.equal(containsSecret('ghp_x'), true);
  assert.equal(containsSecret('Ask the DEMO team.'), false);
});
