import { strict as assert } from 'node:assert';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { ClaudeConfigMcpProvider } from './claude-config.provider';

test('reads user, local and project scopes; project servers need approval; no env values', async () => {
  const home = mkdtempSync(join(tmpdir(), 'ot-mcp-'));
  const proj = join(home, 'proj');
  mkdirSync(proj);
  writeFileSync(join(home, '.claude.json'), JSON.stringify({
    mcpServers: { github: { type: 'http', url: 'https://api.example.com/mcp', env: { TOKEN: 'secret' } } },
    projects: { [proj]: { mcpServers: { local1: { command: '/usr/bin/node' } }, enabledMcpjsonServers: ['on'] } },
  }));
  writeFileSync(join(proj, '.mcp.json'), JSON.stringify({ mcpServers: { on: { command: 'npx' }, off: { command: 'npx' } } }));

  const list = await new ClaudeConfigMcpProvider(home).list([]);
  const by = Object.fromEntries(list.map(s => [s.name, s]));
  assert.equal(by.github?.target, 'api.example.com');
  assert.deepEqual(by.github?.envKeys, ['TOKEN']);
  assert.ok(!JSON.stringify(list).includes('secret'));
  assert.equal(by.local1?.target, 'node');
  assert.equal(by.on?.enabled, true);
  assert.equal(by.off?.enabled, false);
});
