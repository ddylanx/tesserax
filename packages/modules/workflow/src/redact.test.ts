import { strict as assert } from 'node:assert';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { WorkflowController } from './workflow.controller';

const runId = '11111111-1111-4111-8111-111111111111';
const nodeRunId = '22222222-2222-4222-8222-222222222222';

test('a token in a step log is masked in the step-log endpoint response; normal text is unchanged', async t => {
  const data = mkdtempSync(join(tmpdir(), 'tx-redact-'));
  t.after(() => rmSync(data, { recursive: true, force: true }));
  const prev = process.env.DEMO_SERVICE_TOKEN;
  process.env.DEMO_SERVICE_TOKEN = 'demo-service-token-0123456789';
  t.after(() => (prev === undefined ? delete process.env.DEMO_SERVICE_TOKEN : (process.env.DEMO_SERVICE_TOKEN = prev)));

  const dir = join(data, 'runs', runId, nodeRunId);
  mkdirSync(dir, { recursive: true });
  const say = (text: string) => JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text }] } });
  writeFileSync(join(dir, 'stream.ndjson'), [say('Reading the DEMO config.'), say('Found ghp_abcdefABCDEF1234567890 and demo-service-token-0123456789 in .env')].join('\n') + '\n');

  const db = { selectFrom: () => ({ select: () => ({ where: () => ({ where: () => ({ executeTakeFirst: async () => ({ status: 'done' }) }) }) }) }) };
  const controller = Object.assign(Object.create(WorkflowController.prototype), { db, config: { TESSERAX_DATA_DIR: data } }) as WorkflowController;
  const res = await controller.nodeLog(runId, nodeRunId);
  assert.ok(res.text.includes('Reading the DEMO config.'));
  assert.ok(!res.text.includes('ghp_abcdef'));
  assert.ok(!res.text.includes('demo-service-token-0123456789'));
  assert.ok(res.text.includes('Found «redacted:token» and «redacted:DEMO_SERVICE_TOKEN» in .env'));
  assert.equal(res.live, false);
});
