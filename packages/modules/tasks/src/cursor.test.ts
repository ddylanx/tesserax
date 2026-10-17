import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { decodeCursor, encodeCursor } from './cursor';

test('encode and decode cursor round-trip', () => {
  const withDate = {
    u: '2026-10-17T12:30:00.000Z',
    id: 'a1b2c3d4-e5f6-4a1b-8c2d-3e4f5a6b7c8d',
  };
  const enc1 = encodeCursor(withDate);
  const dec1 = decodeCursor(enc1);
  assert.deepEqual(dec1, withDate);

  const withNull = {
    u: null,
    id: '12345678-1234-1234-1234-123456789abc',
  };
  const enc2 = encodeCursor(withNull);
  const dec2 = decodeCursor(enc2);
  assert.deepEqual(dec2, withNull);
});

test('decodeCursor returns null on invalid or malformed cursors', () => {
  assert.equal(decodeCursor('xyz'), null);
  assert.equal(decodeCursor(''), null);

  // Missing id
  const missingId = Buffer.from(JSON.stringify({ u: null }), 'utf8').toString(
    'base64url',
  );
  assert.equal(decodeCursor(missingId), null);

  // Invalid id (not UUID)
  const invalidId = Buffer.from(
    JSON.stringify({ u: null, id: 'not-a-uuid' }),
    'utf8',
  ).toString('base64url');
  assert.equal(decodeCursor(invalidId), null);

  // Invalid date string in u
  const invalidDate = Buffer.from(
    JSON.stringify({
      u: 'not-a-date',
      id: 'a1b2c3d4-e5f6-4a1b-8c2d-3e4f5a6b7c8d',
    }),
    'utf8',
  ).toString('base64url');
  assert.equal(decodeCursor(invalidDate), null);
});
