import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

// Starts the real server over stdio (as an MCP client would, from another folder) against a fake API.
test('stdio: lists tools and calls one against the API', async () => {
  const seen: string[] = [];
  const http = createServer((req, res) => {
    seen.push(`${req.method} ${req.url}`);
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ runs: [], counts: { waiting: 0 } }));
  });
  await new Promise<void>(r => http.listen(0, '127.0.0.1', r));
  const port = (http.address() as AddressInfo).port;
  const client = new Client({ name: 'test', version: '0' });
  try {
    await client.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: [join(__dirname, '..', 'bin.cjs')],
        cwd: tmpdir(),
        env: { ...(process.env as Record<string, string>), TESSERAX_API_URL: `http://127.0.0.1:${port}`, TESSERAX_MCP_MODE: 'act' },
        stderr: 'ignore',
      }),
    );
    const { tools } = await client.listTools();
    const names = tools.map(t => t.name);
    assert.ok(names.includes('tesserax_status') && names.includes('start_run'));
    assert.ok(!names.includes('decide_gate'), 'act mode has no decide tools');
    const res = await client.callTool({ name: 'tesserax_status', arguments: {} });
    assert.ok(!res.isError);
    assert.match((res.content as { text: string }[])[0]!.text, /waitingForPerson/);
    assert.deepEqual(seen, ['GET /api/workflow-runs']);
  } finally {
    await client.close();
    http.close();
  }
});
