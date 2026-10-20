import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { resultModel } from './claude-cli';

test('resultModel picks the model with the largest cost, null when none is reported', () => {
  assert.equal(resultModel({ modelUsage: { 'claude-haiku-5-5': { costUSD: 0.01 }, 'claude-sonnet-5-5': { costUSD: 0.21 } } }), 'claude-sonnet-5-5');
  assert.equal(resultModel({ result: 'done' }), null);
  assert.equal(resultModel(null), null);
});
