import { strict as assert } from 'node:assert';
import { join } from 'node:path';
import { test } from 'node:test';
import { antigravityArgs, antigravitySignal, parseAntigravity, runAntigravity } from './antigravity';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { readLiveLog, renderLiveLog } from './livelog';
import { askAgent } from './claude';

const FAKE = join(__dirname, '../../../../../scripts/fake-agy.mjs');

test('runAntigravity returns the response; auth and denied-shell runs are recognised', async () => {
  const ok = await runAntigravity({ bin: FAKE, cwd: __dirname, prompt: 'hello', timeoutMs: 10_000 });
  assert.equal(ok.signal, 'ok');
  assert.match(ok.text!, /Fake agy answer/);
  for (const [mode, signal] of [['auth', 'auth'], ['denied', 'denied']] as const) {
    process.env.FAKE_AGY_MODE = mode;
    try {
      const r = await runAntigravity({ bin: FAKE, cwd: __dirname, prompt: 'hello', timeoutMs: 10_000 });
      assert.equal(r.signal, signal);
    } finally {
      delete process.env.FAKE_AGY_MODE;
    }
  }
  process.env.FAKE_AGY_MODE = 'auth';
  try {
    await assert.rejects(askAgent({ engine: 'antigravity', claudeBin: 'x', geminiBin: 'x', antigravityBin: FAKE, cwd: __dirname, prompt: 'p', allowedTools: [], timeoutSeconds: 10 }), /antigravity auth/);
  } finally {
    delete process.env.FAKE_AGY_MODE;
  }
});

test('antigravity: missing binary, parsing with log noise, prompt attached to --print', async () => {
  assert.equal((await runAntigravity({ bin: '/nonexistent/agy', cwd: __dirname, prompt: '', timeoutMs: 5000 })).signal, 'not_installed');
  assert.equal(parseAntigravity('log line\n{"conversation_id":"c","status":"SUCCESS","response":"r"}')?.response, 'r');
  assert.equal(antigravitySignal({ out: { status: 'SUCCESS', response: 'x' }, stderr: '', exitCode: 0, timedOut: false }).signal, 'ok');
  assert.equal(antigravitySignal({ out: null, stderr: 'RESOURCE_EXHAUSTED: quota', exitCode: 1, timedOut: false }).signal, 'quota');
  const args = antigravityArgs('plan', '- starts with a dash\nsecond line');
  assert.equal(args.at(-1), '--print=- starts with a dash\nsecond line');
  assert.deepEqual(args.slice(0, 2), ['--mode', 'plan']);
});

test('live log: the event stream is written while running and rendered as readable lines', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ot-livelog-'));
  const logFile = join(dir, 'stream.ndjson');
  const r = await runAntigravity({ bin: FAKE, cwd: __dirname, prompt: 'hello', timeoutMs: 10_000, logFile });
  assert.equal(r.signal, 'ok');
  assert.match(readFileSync(logFile, 'utf8'), /"event":"step_update"/);
  const first = readLiveLog(dir, 0);
  assert.equal(first.exists, true);
  assert.match(first.text, /Started\n→ view_file  .*README\.md\n {2}← 3 lines\n✓ Finished/);
  assert.equal(readLiveLog(dir, first.next).text, ''); // nothing new
  // a half-written last line is left for the next read
  const claude = '{"type":"assistant","message":{"content":[{"type":"text","text":"Looking at the diff"},{"type":"tool_use","name":"Read","input":{"file_path":"a.ts"}}]}}';
  assert.equal(renderLiveLog(`${claude}\n{"type":"res`), 'Looking at the diff\n→ Read  a.ts');
});
