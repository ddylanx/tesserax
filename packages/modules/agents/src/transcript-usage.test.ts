import { strict as assert } from 'node:assert';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { statusFor } from './hook-mapping';
import { readTranscriptUsage } from './transcript-usage';

test('sums usage once per message id and reports context of the last turn', async () => {
  const file = join(mkdtempSync(join(tmpdir(), 'ot-tr-')), 't.jsonl');
  const line = (id: string, u: object, model = 'claude-x') => JSON.stringify({ type: 'assistant', message: { id, model, usage: u } });
  writeFileSync(file, [
    JSON.stringify({ type: 'user', message: { content: 'hi' } }),
    line('a', { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 100 }),
    line('a', { input_tokens: 10, output_tokens: 7, cache_read_input_tokens: 100 }),
    line('b', { input_tokens: 3, output_tokens: 2, cache_creation_input_tokens: 50 }),
    'not json',
  ].join('\n'));
  const u = await readTranscriptUsage(file);
  assert.deepEqual(u, { inputTokens: 13, outputTokens: 9, cacheReadTokens: 100, cacheCreationTokens: 50, contextTokens: 53, model: 'claude-x' });
});

test('maps hook events to statuses', () => {
  const p = (hook_event_name: string, message?: string) => ({ hook_event_name, session_id: 's', message });
  assert.equal(statusFor(p('UserPromptSubmit')), 'running');
  assert.equal(statusFor(p('Notification', 'Claude needs your permission to use Bash')), 'waiting');
  assert.equal(statusFor(p('Notification', 'Claude is waiting for your input')), 'idle');
  assert.equal(statusFor(p('Stop')), 'idle');
  assert.equal(statusFor(p('SessionEnd')), 'ended');
  assert.equal(statusFor(p('SubagentStop')), undefined);
});
