import { strict as assert } from 'node:assert';
import { copyFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { findRepoRoot } from '@tesserax/config';
import { chooseMcpProvider } from '../mcp.module';
import { BuiltinMcpProvider, parseCodexToml } from './builtin.provider';

test('parseCodexToml parses TOML tables, env keys, commands, and URLs', () => {
  const toml = `
    # Config file for Codex CLI
    [mcp_servers.codex-mock]
    command = "uvx"
    args = ["codex-helper"]
    disabled = false # inline comment

    [mcp_servers.codex-mock.env]
    CODEX_SECRET = "secret_val"
    CODEX_PORT = "8080"

    [mcp_servers."remote.service"]
    url = "https://remote.example.com/sse"
    type = "sse"
    disabled = true

    [mcp_servers.inline-env]
    command = "node"
    env = { FOO = "bar", BAZ = "qux" }

    [other_section]
    ignore_me = true
  `;

  const parsed = parseCodexToml(toml);
  assert.equal(parsed['codex-mock']?.command, 'uvx');
  assert.equal(parsed['codex-mock']?.disabled, false);
  assert.deepEqual(parsed['codex-mock']?.envKeys, ['CODEX_SECRET', 'CODEX_PORT']);

  assert.equal(parsed['remote.service']?.url, 'https://remote.example.com/sse');
  assert.equal(parsed['remote.service']?.type, 'sse');
  assert.equal(parsed['remote.service']?.disabled, true);

  assert.equal(parsed['inline-env']?.command, 'node');
  assert.deepEqual(parsed['inline-env']?.envKeys, ['FOO', 'BAZ']);

  assert.equal(parsed['other_section'], undefined);
});

test('reads Claude Code user, local and project scopes with permissions', async () => {
  const home = mkdtempSync(join(tmpdir(), 'ot-mcp-claude-'));
  const proj = join(home, 'proj');
  mkdirSync(proj);

  writeFileSync(
    join(home, '.claude.json'),
    JSON.stringify({
      mcpServers: {
        github: { type: 'http', url: 'https://api.example.com/mcp', env: { TOKEN: 'super_secret' } },
      },
      projects: {
        [proj]: {
          mcpServers: { local1: { command: '/usr/bin/node' } },
          enabledMcpjsonServers: ['on'],
          disabledMcpjsonServers: ['disabled-by-list'],
        },
      },
    }),
  );

  writeFileSync(
    join(proj, '.mcp.json'),
    JSON.stringify({
      mcpServers: {
        on: { command: 'npx' },
        off: { command: 'npx' },
        'disabled-by-list': { command: 'npx' },
        'explicitly-disabled': { command: 'npx', disabled: true },
      },
    }),
  );

  const provider = new BuiltinMcpProvider(home);
  const list = await provider.list([proj]);
  const by = Object.fromEntries(list.map(s => [s.name, s]));

  assert.equal(by.github?.client, 'Claude Code');
  assert.equal(by.github?.scope, 'user');
  assert.equal(by.github?.target, 'api.example.com');
  assert.equal(by.github?.transport, 'http');
  assert.deepEqual(by.github?.envKeys, ['TOKEN']);
  assert.equal(by.github?.enabled, true);

  assert.equal(by.local1?.client, 'Claude Code');
  assert.equal(by.local1?.target, 'node');
  assert.equal(by.local1?.scope, 'local:~/proj');

  assert.equal(by.on?.scope, 'project:~/proj');
  assert.equal(by.on?.enabled, true);

  assert.equal(by.off?.enabled, false);
  assert.equal(by['disabled-by-list']?.enabled, false);
  assert.equal(by['explicitly-disabled']?.enabled, false);

  assert.ok(!JSON.stringify(list).includes('super_secret'));
});

test('reads Cursor user and project configs', async () => {
  const home = mkdtempSync(join(tmpdir(), 'ot-mcp-cursor-'));
  const proj = join(home, 'my-cursor-project');
  mkdirSync(join(home, '.cursor'), { recursive: true });
  mkdirSync(join(proj, '.cursor'), { recursive: true });

  writeFileSync(
    join(home, '.cursor', 'mcp.json'),
    JSON.stringify({
      mcpServers: {
        'cursor-user': { command: 'cursor-tool', env: { CURSOR_KEY: 'secret_cursor' } },
      },
    }),
  );

  writeFileSync(
    join(proj, '.cursor', 'mcp.json'),
    JSON.stringify({
      mcpServers: {
        'cursor-proj': { command: '/usr/local/bin/python3', disabled: true },
      },
    }),
  );

  const provider = new BuiltinMcpProvider(home);
  const list = await provider.list([proj]);
  const by = Object.fromEntries(list.map(s => [s.name, s]));

  assert.equal(by['cursor-user']?.client, 'Cursor');
  assert.equal(by['cursor-user']?.scope, 'user');
  assert.equal(by['cursor-user']?.file, '~/.cursor/mcp.json');
  assert.equal(by['cursor-user']?.enabled, true);
  assert.deepEqual(by['cursor-user']?.envKeys, ['CURSOR_KEY']);

  assert.equal(by['cursor-proj']?.client, 'Cursor');
  assert.equal(by['cursor-proj']?.scope, 'project:~/my-cursor-project');
  assert.equal(by['cursor-proj']?.target, 'python3');
  assert.equal(by['cursor-proj']?.enabled, false);

  assert.ok(!JSON.stringify(list).includes('secret_cursor'));
});

test('reads Claude Desktop config with OS platform variations', async () => {
  const home = mkdtempSync(join(tmpdir(), 'ot-mcp-desktop-'));

  // darwin
  const darwinDir = join(home, 'Library', 'Application Support', 'Claude');
  mkdirSync(darwinDir, { recursive: true });
  writeFileSync(
    join(darwinDir, 'claude_desktop_config.json'),
    JSON.stringify({ mcpServers: { 'desktop-mac': { command: 'mac-mcp' } } }),
  );
  const macList = await new BuiltinMcpProvider(home, 'darwin').list([]);
  assert.equal(macList[0]?.name, 'desktop-mac');
  assert.equal(macList[0]?.client, 'Claude Desktop');
  assert.equal(macList[0]?.file, '~/Library/Application Support/Claude/claude_desktop_config.json');

  // win32
  const winDir = join(home, 'AppData', 'Roaming', 'Claude');
  mkdirSync(winDir, { recursive: true });
  writeFileSync(
    join(winDir, 'claude_desktop_config.json'),
    JSON.stringify({ mcpServers: { 'desktop-win': { command: 'win-mcp' } } }),
  );
  const winList = await new BuiltinMcpProvider(home, 'win32', { APPDATA: join(home, 'AppData', 'Roaming') }).list([]);
  assert.equal(winList[0]?.name, 'desktop-win');
  assert.equal(winList[0]?.client, 'Claude Desktop');

  // linux
  const linuxDir = join(home, '.config', 'Claude');
  mkdirSync(linuxDir, { recursive: true });
  writeFileSync(
    join(linuxDir, 'claude_desktop_config.json'),
    JSON.stringify({ mcpServers: { 'desktop-linux': { command: 'linux-mcp' } } }),
  );
  const linuxList = await new BuiltinMcpProvider(home, 'linux', { XDG_CONFIG_HOME: join(home, '.config') }).list([]);
  assert.equal(linuxList[0]?.name, 'desktop-linux');
  assert.equal(linuxList[0]?.client, 'Claude Desktop');
  assert.equal(linuxList[0]?.file, '~/.config/Claude/claude_desktop_config.json');
});

test('reads Gemini CLI and Antigravity configs', async () => {
  const home = mkdtempSync(join(tmpdir(), 'ot-mcp-gemini-'));
  const proj = join(home, 'gemini-project');
  mkdirSync(join(home, '.gemini', 'antigravity'), { recursive: true });
  mkdirSync(join(proj, '.gemini'), { recursive: true });

  writeFileSync(
    join(home, '.gemini', 'settings.json'),
    JSON.stringify({ mcpServers: { 'gemini-global': { command: 'gemini-run' } } }),
  );
  writeFileSync(
    join(proj, '.gemini', 'settings.json'),
    JSON.stringify({ mcpServers: { 'gemini-local': { command: 'gemini-sub' } } }),
  );
  writeFileSync(
    join(home, '.gemini', 'antigravity', 'mcp_config.json'),
    JSON.stringify({
      mcpServers: {
        'anti-server': { url: 'https://anti.example.com/sse', type: 'sse', env: { ANTI_KEY: 'secret_anti' } },
      },
    }),
  );

  const provider = new BuiltinMcpProvider(home);
  const list = await provider.list([proj]);
  const by = Object.fromEntries(list.map(s => [s.name, s]));

  assert.equal(by['gemini-global']?.client, 'Gemini CLI');
  assert.equal(by['gemini-global']?.scope, 'user');

  assert.equal(by['gemini-local']?.client, 'Gemini CLI');
  assert.equal(by['gemini-local']?.scope, 'project:~/gemini-project');

  assert.equal(by['anti-server']?.client, 'Antigravity');
  assert.equal(by['anti-server']?.scope, 'user');
  assert.equal(by['anti-server']?.transport, 'sse');
  assert.equal(by['anti-server']?.target, 'anti.example.com');
  assert.deepEqual(by['anti-server']?.envKeys, ['ANTI_KEY']);
  assert.ok(!JSON.stringify(list).includes('secret_anti'));
});

test('reads Codex CLI config.toml', async () => {
  const home = mkdtempSync(join(tmpdir(), 'ot-mcp-codex-'));
  mkdirSync(join(home, '.codex'), { recursive: true });

  writeFileSync(
    join(home, '.codex', 'config.toml'),
    `
      [mcp_servers.codex-server]
      command = "uvx"
      disabled = false

      [mcp_servers.codex-server.env]
      CODEX_KEY = "super_codex_secret"
    `,
  );

  const provider = new BuiltinMcpProvider(home);
  const list = await provider.list([]);
  assert.equal(list.length, 1);
  assert.equal(list[0]?.name, 'codex-server');
  assert.equal(list[0]?.client, 'Codex CLI');
  assert.equal(list[0]?.scope, 'user');
  assert.equal(list[0]?.file, '~/.codex/config.toml');
  assert.equal(list[0]?.enabled, true);
  assert.deepEqual(list[0]?.envKeys, ['CODEX_KEY']);
  assert.ok(!JSON.stringify(list).includes('super_codex_secret'));
});

test('handles missing, corrupted, or malformed config files gracefully', async () => {
  const home = mkdtempSync(join(tmpdir(), 'ot-mcp-corrupt-'));
  const proj = join(home, 'corrupt-proj');
  mkdirSync(join(home, '.cursor'), { recursive: true });
  mkdirSync(join(home, '.codex'), { recursive: true });
  mkdirSync(proj);

  // Write invalid JSON and broken TOML
  writeFileSync(join(home, '.claude.json'), '{ broken json ');
  writeFileSync(join(home, '.cursor', 'mcp.json'), 'not even json');
  writeFileSync(join(home, '.codex', 'config.toml'), '%%% INVALID TOML %%%');

  const provider = new BuiltinMcpProvider(home);
  // Should not throw, should return empty array safely
  const list = await provider.list([proj, proj]);
  assert.ok(Array.isArray(list));
  assert.equal(list.length, 0);
});

test('chooseMcpProvider returns BuiltinMcpProvider instance', () => {
  const provider = chooseMcpProvider();
  assert.equal(provider.name, 'builtin');
  assert.ok(provider instanceof BuiltinMcpProvider);
});

test('discovers all 6 clients from repository fixtures in fixtures/mcp', async () => {
  const root = findRepoRoot();
  const fixturesDir = join(root, 'fixtures', 'mcp');
  const home = mkdtempSync(join(tmpdir(), 'ot-mcp-fixtures-'));
  const proj = join(home, 'fixture-proj');
  mkdirSync(proj, { recursive: true });

  // 1. Claude Code
  copyFileSync(join(fixturesDir, 'claude', 'claude.json'), join(home, '.claude.json'));
  copyFileSync(join(fixturesDir, 'claude', 'mcp.json'), join(proj, '.mcp.json'));

  // 2. Cursor
  mkdirSync(join(home, '.cursor'), { recursive: true });
  copyFileSync(join(fixturesDir, 'cursor', 'mcp.json'), join(home, '.cursor', 'mcp.json'));

  // 3. Claude Desktop (darwin)
  const desktopDir = join(home, 'Library', 'Application Support', 'Claude');
  mkdirSync(desktopDir, { recursive: true });
  copyFileSync(join(fixturesDir, 'claude-desktop', 'claude_desktop_config.json'), join(desktopDir, 'claude_desktop_config.json'));

  // 4. Gemini CLI
  mkdirSync(join(home, '.gemini'), { recursive: true });
  copyFileSync(join(fixturesDir, 'gemini', 'settings.json'), join(home, '.gemini', 'settings.json'));

  // 5. Antigravity
  mkdirSync(join(home, '.gemini', 'antigravity'), { recursive: true });
  copyFileSync(join(fixturesDir, 'antigravity', 'mcp_config.json'), join(home, '.gemini', 'antigravity', 'mcp_config.json'));

  // 6. Codex CLI
  mkdirSync(join(home, '.codex'), { recursive: true });
  copyFileSync(join(fixturesDir, 'codex', 'config.toml'), join(home, '.codex', 'config.toml'));

  const provider = new BuiltinMcpProvider(home, 'darwin');
  const list = await provider.list([proj]);

  const clientNames = new Set(list.map(s => s.client));
  assert.ok(clientNames.has('Claude Code'));
  assert.ok(clientNames.has('Cursor'));
  assert.ok(clientNames.has('Claude Desktop'));
  assert.ok(clientNames.has('Gemini CLI'));
  assert.ok(clientNames.has('Antigravity'));
  assert.ok(clientNames.has('Codex CLI'));

  // Ensure no secret values from fixtures are in the returned payload
  const jsonStr = JSON.stringify(list);
  assert.ok(!jsonStr.includes('secret_anti_val'));
  assert.ok(!jsonStr.includes('secret_claude_val'));
  assert.ok(!jsonStr.includes('secret_approved_val'));
  assert.ok(!jsonStr.includes('secret_cursor_val'));
  assert.ok(!jsonStr.includes('secret_desktop_val'));
  assert.ok(!jsonStr.includes('secret_gemini_val'));
  assert.ok(!jsonStr.includes('secret_codex_val'));

  // Ensure envKeys are present
  const byName = Object.fromEntries(list.map(s => [s.name, s]));
  assert.deepEqual(byName['antigravity-mock']?.envKeys, ['ANTIGRAVITY_TOKEN']);
  assert.deepEqual(byName['claude-user-mock']?.envKeys, ['CLAUDE_USER_SECRET']);
  assert.deepEqual(byName['cursor-mock']?.envKeys, ['CURSOR_API_KEY']);
  assert.deepEqual(byName['claude-desktop-mock']?.envKeys, ['DESKTOP_SECRET']);
  assert.deepEqual(byName['gemini-mock']?.envKeys, ['GEMINI_API_KEY']);
  assert.deepEqual(byName['codex-mock']?.envKeys, ['CODEX_SECRET']);
});
