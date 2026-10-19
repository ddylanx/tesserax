import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import type { Db } from '@tesserax/db';
import { McpService } from './mcp.service';
import type { FullMcpServer, McpStatusProvider } from './provider';

function createMockDb(initialPolicies: any[] = [], initialCaches: any[] = []) {
  const policies = [...initialPolicies];
  const caches = [...initialCaches];

  const db = {
    selectFrom: (table: string) => {
      const getRows = () => (table === 'mcp_policy' ? policies : caches);
      return {
        selectAll: () => ({
          where: (col: string, op: string, val: any) => ({
            execute: async () => getRows().filter(r => (op === '!=' ? r[col] !== val : r[col] === val)),
            executeTakeFirst: async () => getRows().find(r => (op === '!=' ? r[col] !== val : r[col] === val)),
          }),
          execute: async () => [...getRows()],
          executeTakeFirst: async () => getRows()[0],
        }),
      };
    },
    updateTable: (table: string) => ({
      set: (data: any) => ({
        where: (col: string, op: string, val: any) => ({
          execute: async () => {
            const rows = table === 'mcp_policy' ? policies : caches;
            const idx = rows.findIndex(r => r[col] === val);
            if (idx >= 0) {
              rows[idx] = { ...rows[idx], ...data };
            }
          },
        }),
      }),
    }),
    insertInto: (table: string) => ({
      values: (data: any) => ({
        execute: async () => {
          const rows = table === 'mcp_policy' ? policies : caches;
          rows.push({ ...data });
        },
      }),
    }),
  } as unknown as Db;

  return { policies, caches, db };
}

function createMockProvider(servers: FullMcpServer[] = []): McpStatusProvider {
  return {
    name: 'mock',
    list: async () => servers.map(({ definition, ...s }) => s),
    listFull: async () => servers,
  };
}

test('McpService.grantFor: deny by default when unconfigured or mode is off', async () => {
  const { db } = createMockDb([]);
  const provider = createMockProvider([
    {
      id: 'Claude Code|user|postgres',
      name: 'postgres',
      client: 'Claude Code',
      scope: 'user',
      file: '~/.claude.json',
      transport: 'stdio',
      target: 'pg',
      enabled: true,
      envKeys: [],
      definition: { command: 'pg-mcp' },
    },
  ]);
  const service = new McpService(db, provider);

  // Unconfigured server -> empty
  const grant1 = await service.grantFor({ engine: 'claude' });
  assert.deepEqual(grant1.servers, []);

  // Server with mode = 'off'
  const { db: dbOff } = createMockDb([
    { server: 'postgres', mode: 'off', tools: '[]', engines: '["claude","gemini","antigravity"]' },
  ]);
  const serviceOff = new McpService(dbOff, provider);
  const grant2 = await serviceOff.grantFor({ engine: 'claude' });
  assert.deepEqual(grant2.servers, []);
});

test('McpService.grantFor: returns tools: * for mode all and specific array for mode tools', async () => {
  const { db } = createMockDb([
    { server: 'srv-all', mode: 'all', tools: '[]', engines: '["claude","antigravity"]' },
    { server: 'srv-tools', mode: 'tools', tools: '["select","insert"]', engines: '["claude"]' },
  ]);

  const provider = createMockProvider([
    {
      id: '1', name: 'srv-all', client: 'Claude Code', scope: 'user', file: '', transport: 'stdio', target: 'srv1',
      enabled: true, envKeys: [], definition: { command: 'srv1' },
    },
    {
      id: '2', name: 'srv-tools', client: 'Claude Code', scope: 'user', file: '', transport: 'stdio', target: 'srv2',
      enabled: true, envKeys: [], definition: { command: 'srv2' },
    },
  ]);

  const service = new McpService(db, provider);
  const grant = await service.grantFor({ engine: 'claude' });

  assert.equal(grant.servers.length, 2);
  const srvAll = grant.servers.find(s => s.name === 'srv-all');
  const srvTools = grant.servers.find(s => s.name === 'srv-tools');

  assert.ok(srvAll);
  assert.equal(srvAll.tools, '*');
  assert.deepEqual(srvAll.definition, { command: 'srv1' });

  assert.ok(srvTools);
  assert.deepEqual(srvTools.tools, ['select', 'insert']);
  assert.deepEqual(srvTools.definition, { command: 'srv2' });
});

test('McpService.grantFor: filters by engine', async () => {
  const { db } = createMockDb([
    { server: 'claude-only', mode: 'all', tools: '[]', engines: '["claude"]' },
  ]);
  const provider = createMockProvider([
    {
      id: '1', name: 'claude-only', client: 'Claude Code', scope: 'user', file: '', transport: 'stdio', target: 'c',
      enabled: true, envKeys: [], definition: { command: 'c' },
    },
  ]);
  const service = new McpService(db, provider);

  const grantGemini = await service.grantFor({ engine: 'gemini' });
  assert.deepEqual(grantGemini.servers, []);

  const grantClaude = await service.grantFor({ engine: 'claude' });
  assert.equal(grantClaude.servers.length, 1);
  assert.equal(grantClaude.servers[0]?.name, 'claude-only');
});

test('McpService.grantFor: node narrowing intersection cannot widen permissions', async () => {
  const { db } = createMockDb([
    { server: 'postgres', mode: 'tools', tools: '["select","insert"]', engines: '["claude"]' },
  ]);
  const provider = createMockProvider([
    {
      id: '1', name: 'postgres', client: 'Claude Code', scope: 'user', file: '', transport: 'stdio', target: 'pg',
      enabled: true, envKeys: [], definition: { command: 'pg' },
    },
  ]);
  const service = new McpService(db, provider);

  // Node requests ['select', 'delete'] -> intersection with ['select', 'insert'] is ['select']
  const grant = await service.grantFor({
    engine: 'claude',
    node: { mcp: { servers: ['postgres'], tools: ['select', 'delete'] } },
  });

  assert.equal(grant.servers.length, 1);
  assert.deepEqual(grant.servers[0]?.tools, ['select']);

  // Node requests a server not enabled in policy -> empty
  const grantUnlisted = await service.grantFor({
    engine: 'claude',
    node: { mcp: { servers: ['unlisted-server'] } },
  });
  assert.deepEqual(grantUnlisted.servers, []);

  // Node requests tools disjoint from policy -> server excluded
  const grantDisjoint = await service.grantFor({
    engine: 'claude',
    node: { mcp: { servers: ['postgres'], tools: ['delete'] } },
  });
  assert.deepEqual(grantDisjoint.servers, []);
});

test('McpService.updatePolicy: persists policy updates in db', async () => {
  const { db, policies } = createMockDb([]);
  const provider = createMockProvider([]);
  const service = new McpService(db, provider);

  await service.updatePolicy('postgres', {
    mode: 'tools',
    tools: ['list_tables', 'query'],
    engines: ['claude'],
  });

  assert.equal(policies.length, 1);
  assert.equal(policies[0]?.server, 'postgres');
  assert.equal(policies[0]?.mode, 'tools');
  assert.deepEqual(JSON.parse(policies[0]?.tools), ['list_tables', 'query']);
  assert.deepEqual(JSON.parse(policies[0]?.engines), ['claude']);
});

test('McpService.refreshTools: probes tools, updates mcp_tool_cache and returns tool list', async () => {
  const { db, caches } = createMockDb([]);
  const provider = createMockProvider([
    {
      id: '1', name: 'postgres', client: 'Claude Code', scope: 'user', file: '', transport: 'stdio', target: 'pg',
      enabled: true, envKeys: [], definition: { command: 'pg' },
    },
  ]);
  const service = new McpService(db, provider);

  const mockProbe = async (def: Record<string, unknown>) => [
    { name: 'list_tables', description: 'List all tables' },
    { name: 'query', description: 'Execute a SQL query' },
    { name: 'stats' },
  ];

  const res = await service.refreshTools('postgres', undefined, mockProbe);
  assert.equal(res.server, 'postgres');
  assert.equal(res.tools.length, 3);
  assert.equal(res.tools[0]?.name, 'list_tables');
  assert.ok(res.readAt);
  assert.equal(caches.length, 1);
  assert.equal(caches[0]?.server, 'postgres');
  assert.deepEqual(JSON.parse(caches[0]?.tools), res.tools);
  assert.ok(caches[0]?.read_at);

  // Update existing cache entry
  const updateProbe = async () => [{ name: 'list_tables' }];
  const resUpdated = await service.refreshTools('postgres', undefined, updateProbe);
  assert.equal(resUpdated.tools.length, 1);
  assert.equal(caches.length, 1);
  assert.deepEqual(JSON.parse(caches[0]?.tools), [{ name: 'list_tables' }]);

  // Non-existent server throws
  await assert.rejects(
    service.refreshTools('nonexistent', undefined, mockProbe),
    /MCP server not found: nonexistent/,
  );
});

test('McpService.grantFor: skips servers that have no valid definition in provider', async () => {
  const { db } = createMockDb([
    { server: 'orphaned-server', mode: 'all', tools: '[]', engines: '["claude"]' },
  ]);
  const provider = createMockProvider([]); // not in client configs
  const service = new McpService(db, provider);

  const grant = await service.grantFor({ engine: 'claude' });
  assert.deepEqual(grant.servers, []);
});
