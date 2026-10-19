import { strict as assert } from 'node:assert';
import { existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { askClaude } from './claude';

const FAKE = join(__dirname, '../../../../../scripts/fake-claude.mjs');

test('askClaude creates ephemeral mcp.json with mode 0600 and cleans it up after run', async () => {
  const r = await askClaude({
    bin: FAKE,
    cwd: __dirname,
    prompt: 'hello',
    allowedTools: [],
    timeoutSeconds: 10,
    mcpServers: [
      { name: 'db', definition: { command: 'db-cli', env: { DB_PASS: 'top_secret' } }, tools: ['query'] },
    ],
  });

  assert.ok(r.text.length > 0);

  // Check that no orphaned ot-claude-mcp-* directories remain with mcp.json in tmpdir
  const tempFiles = readdirSync(tmpdir()).filter(f => f.startsWith('ot-claude-mcp-'));
  for (const f of tempFiles) {
    const full = join(tmpdir(), f);
    assert.equal(existsSync(join(full, 'mcp.json')), false, `Ephemeral mcp.json was not cleaned up: ${full}`);
  }
});

test('askClaude cleans up ephemeral mcp.json even if the CLI run fails', async () => {
  process.env.FAKE_CLAUDE_MODE = 'crash';
  try {
    await assert.rejects(
      askClaude({
        bin: FAKE,
        cwd: __dirname,
        prompt: 'hello',
        allowedTools: [],
        timeoutSeconds: 10,
        mcpServers: [
          { name: 'db', definition: { command: 'db-cli' }, tools: '*' },
        ],
      }),
    );

    // Verify temp cleanup happened despite failure
    const tempFiles = readdirSync(tmpdir()).filter(f => f.startsWith('ot-claude-mcp-'));
    for (const f of tempFiles) {
      const full = join(tmpdir(), f);
      assert.equal(existsSync(join(full, 'mcp.json')), false, `Ephemeral mcp.json was not cleaned up on error: ${full}`);
    }
  } finally {
    delete process.env.FAKE_CLAUDE_MODE;
  }
});
