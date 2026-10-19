import { strict as assert } from 'node:assert';
import { join } from 'node:path';
import { test } from 'node:test';
import { askAgent } from './claude';
import { geminiArgs, geminiSignal, parseGemini, runGemini } from './gemini';

const FAKE = join(__dirname, '../../../../../scripts/fake-gemini.mjs');

test('runGemini returns the response; auth errors are recognised', async () => {
  const ok = await runGemini({ bin: FAKE, cwd: __dirname, prompt: 'hello', timeoutMs: 10_000 });
  assert.equal(ok.signal, 'ok');
  assert.match(ok.text!, /Fake gemini answer/);
  process.env.FAKE_GEMINI_MODE = 'auth';
  try {
    const bad = await runGemini({ bin: FAKE, cwd: __dirname, prompt: 'hello', timeoutMs: 10_000 });
    assert.equal(bad.signal, 'auth');
    await assert.rejects(askAgent({ engine: 'gemini', claudeBin: 'x', geminiBin: FAKE, antigravityBin: 'agy', cwd: __dirname, prompt: 'p', allowedTools: [], timeoutSeconds: 10 }), /gemini auth/);
  } finally {
    delete process.env.FAKE_GEMINI_MODE;
  }
});

test('gemini signals: missing binary, untrusted folder for edits, quota', async () => {
  assert.equal((await runGemini({ bin: '/nonexistent/gemini', cwd: __dirname, prompt: '', timeoutMs: 5000 })).signal, 'not_installed');
  assert.equal(geminiSignal({ out: { response: 'x' }, stderr: 'Approval mode overridden to "default" because the current folder is not trusted.', exitCode: 0, timedOut: false, needsEdits: true }).signal, 'untrusted');
  assert.equal(geminiSignal({ out: { error: { message: 'RESOURCE_EXHAUSTED: quota' } }, stderr: '', exitCode: 1, timedOut: false }).signal, 'quota');
  assert.equal(parseGemini('noise\n{"response":"r"}')?.response, 'r');
});

test('geminiArgs: includes --allowed-mcp-server-names when allowedMcpServers is provided', () => {
  const args = geminiArgs('plan', 'gemini-1.5-pro', ['github', 'postgres']);
  assert.ok(args.includes('--allowed-mcp-server-names'));
  assert.equal(args[args.indexOf('--allowed-mcp-server-names') + 1], 'github,postgres');

  const argsEmpty = geminiArgs('plan', undefined, []);
  assert.ok(!argsEmpty.includes('--allowed-mcp-server-names'));
});
