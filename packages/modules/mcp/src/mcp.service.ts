import { Inject, Injectable } from '@nestjs/common';
import { createLogger, DB } from '@tesserax/core';
import type { Db } from '@tesserax/db';

const log = createLogger('mcp:service');
import type {
  McpEngine,
  McpGrant,
  McpGrantServer,
  McpList,
  McpPolicy,
  McpPolicyMode,
  McpServerPolicyDto,
  McpToolCache,
  McpToolItem,
  UpdateMcpPolicyDto,
} from '@tesserax/contracts';
import { MCP_STATUS_PROVIDER, type FullMcpServer, type McpStatusProvider } from './provider';
import { probeMcpTools } from './mcp-probe';
import { syncAntigravityMcpRules } from './antigravity-settings';

/** Extra project folders to scan (e.g. where agents ran). */
export type ProjectDirsSource = () => Promise<string[]>;

function parseJsonField<T>(val: unknown, fallback: T): T {
  if (typeof val === 'string') {
    try {
      return JSON.parse(val) as T;
    } catch {
      return fallback;
    }
  }
  return (val as T) ?? fallback;
}

@Injectable()
export class McpService {
  private cache?: { at: number; value: McpList };
  private projectDirSources: ProjectDirsSource[] = [];

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(MCP_STATUS_PROVIDER) private readonly provider: McpStatusProvider,
  ) {}

  addProjectDirsSource(source: ProjectDirsSource) {
    this.projectDirSources.push(source);
  }

  async getProjectDirs(): Promise<string[]> {
    const dirs = (await Promise.all(this.projectDirSources.map(s => s().catch(() => [])))).flat();
    return [...new Set(dirs)];
  }

  async list(fresh = false): Promise<McpList> {
    if (!fresh && this.cache && Date.now() - this.cache.at < 10_000) return this.cache.value;
    const dirs = await this.getProjectDirs();
    const servers = await this.provider.list(dirs);
    servers.sort((a, b) => Number(b.enabled) - Number(a.enabled) || a.name.localeCompare(b.name) || a.client.localeCompare(b.client));
    const value: McpList = { provider: this.provider.name, generatedAt: new Date().toISOString(), servers };
    this.cache = { at: Date.now(), value };
    return value;
  }

  async listWithPolicy(fresh = false): Promise<McpServerPolicyDto[]> {
    const dirs = await this.getProjectDirs();
    const servers = await this.provider.list(dirs);

    const policies = await this.db.selectFrom('mcp_policy').selectAll().execute();
    const policyMap = new Map(policies.map(p => [p.server, p]));

    const caches = await this.db.selectFrom('mcp_tool_cache').selectAll().execute();
    const cacheMap = new Map(caches.map(c => [c.server, c]));

    const result: McpServerPolicyDto[] = servers.map(s => {
      const p = policyMap.get(s.name);
      const c = cacheMap.get(s.name);
      const isProd = /prod/i.test(s.name) || /prod/i.test(s.target);

      const policy: McpPolicy | null = p
        ? {
            server: p.server,
            mode: p.mode as McpPolicyMode,
            tools: parseJsonField<string[]>(p.tools, []),
            engines: parseJsonField<McpEngine[]>(p.engines, ['claude', 'antigravity', 'gemini']),
            updatedAt: p.updated_at instanceof Date ? p.updated_at.toISOString() : String(p.updated_at ?? ''),
          }
        : null;

      const cachedTools: McpToolItem[] | null = c ? parseJsonField<McpToolItem[]>(c.tools, []) : null;
      const toolsReadAt: string | null = c
        ? c.read_at instanceof Date
          ? c.read_at.toISOString()
          : String(c.read_at ?? '')
        : null;

      return {
        ...s,
        policy,
        cachedTools,
        toolsReadAt,
        isProd,
      };
    });

    result.sort((a, b) => Number(b.enabled) - Number(a.enabled) || a.name.localeCompare(b.name) || a.client.localeCompare(b.client));
    return result;
  }

  async updatePolicy(server: string, dto: UpdateMcpPolicyDto): Promise<McpPolicy> {
    const existing = await this.db.selectFrom('mcp_policy').selectAll().where('server', '=', server).executeTakeFirst();
    const mode = dto.mode;
    const tools = dto.tools !== undefined ? dto.tools : parseJsonField<string[]>(existing?.tools, []);
    const engines = dto.engines !== undefined ? dto.engines : parseJsonField<McpEngine[]>(existing?.engines, ['claude', 'antigravity', 'gemini']);
    const now = new Date();

    if (existing) {
      await this.db
        .updateTable('mcp_policy')
        .set({
          mode,
          tools: JSON.stringify(tools),
          engines: JSON.stringify(engines),
          updated_at: now,
        })
        .where('server', '=', server)
        .execute();
    } else {
      await this.db
        .insertInto('mcp_policy')
        .values({
          server,
          mode,
          tools: JSON.stringify(tools),
          engines: JSON.stringify(engines),
          updated_at: now,
        })
        .execute();
    }

    try {
      await this.syncAntigravity();
    } catch (err) {
      log.warn({ err }, 'Failed to sync Antigravity settings');
    }

    return {
      server,
      mode,
      tools,
      engines,
      updatedAt: now.toISOString(),
    };
  }

  async syncAntigravity(): Promise<void> {
    const policies = await this.db.selectFrom('mcp_policy').selectAll().execute();
    const active = policies.filter(p => {
      const engines = parseJsonField<string[]>(p.engines, []);
      return p.mode !== 'off' && engines.includes('antigravity');
    });

    const rules: string[] = [];
    for (const p of active) {
      if (p.mode === 'all') {
        rules.push(`mcp(${p.server}/*)`);
      } else if (p.mode === 'tools') {
        const tools = parseJsonField<string[]>(p.tools, []);
        for (const t of tools) {
          rules.push(`mcp(${p.server}/${t})`);
        }
      }
    }

    const managedServers = policies.map(p => p.server);
    await syncAntigravityMcpRules(rules, { managedServers });
  }

  async refreshTools(
    server: string,
    projectDirs?: string[],
    probeFn: (def: Record<string, unknown>) => Promise<McpToolItem[]> = probeMcpTools,
  ): Promise<McpToolCache> {
    const dirs = projectDirs ?? (await this.getProjectDirs());
    const fullServers = await this.provider.listFull(dirs);
    const srv = fullServers.find(s => s.name === server);
    if (!srv) {
      throw new Error(`MCP server not found: ${server}`);
    }

    const tools = await probeFn(srv.definition);
    const now = new Date();

    const existing = await this.db.selectFrom('mcp_tool_cache').selectAll().where('server', '=', server).executeTakeFirst();
    if (existing) {
      await this.db
        .updateTable('mcp_tool_cache')
        .set({
          tools: JSON.stringify(tools),
          read_at: now,
        })
        .where('server', '=', server)
        .execute();
    } else {
      await this.db
        .insertInto('mcp_tool_cache')
        .values({
          server,
          tools: JSON.stringify(tools),
          read_at: now,
        })
        .execute();
    }

    return {
      server,
      tools,
      readAt: now.toISOString(),
    };
  }

  async grantFor(opts: {
    engine: 'claude' | 'antigravity' | 'gemini';
    node?: { mcp?: { servers?: string[]; tools?: string[] } };
    projectDirs?: string[];
  }): Promise<McpGrant> {
    const policies = await this.db.selectFrom('mcp_policy').selectAll().where('mode', '!=', 'off').execute();
    const enginePolicies = policies.filter(p => {
      const engines = parseJsonField<string[]>(p.engines, []);
      return engines.includes(opts.engine);
    });

    if (enginePolicies.length === 0) {
      return { servers: [] };
    }

    let candidatePolicies = enginePolicies;
    if (opts.node?.mcp?.servers) {
      const allowed = new Set(opts.node.mcp.servers);
      candidatePolicies = candidatePolicies.filter(p => allowed.has(p.server));
    }

    const dirs = opts.projectDirs ?? (await this.getProjectDirs());
    const fullServers = await this.provider.listFull(dirs);
    const defMap = new Map<string, Record<string, unknown>>(fullServers.map(s => [s.name, s.definition]));

    const servers: McpGrantServer[] = [];
    for (const p of candidatePolicies) {
      const def = defMap.get(p.server);
      if (!def || (!def.command && !def.url)) {
        continue;
      }
      let tools: string[] | '*' = '*';
      if (p.mode === 'tools') {
        tools = parseJsonField<string[]>(p.tools, []);
      }

      if (opts.node?.mcp?.tools) {
        const nodeTools = new Set(opts.node.mcp.tools);
        if (tools === '*') {
          tools = opts.node.mcp.tools;
        } else {
          tools = tools.filter(t => nodeTools.has(t));
        }
      }

      if (Array.isArray(tools) && tools.length === 0) {
        continue;
      }

      servers.push({
        name: p.server,
        definition: def,
        tools,
      });
    }

    return { servers };
  }
}
