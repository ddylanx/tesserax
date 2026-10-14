import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import type { McpServerDto } from '@tesserax/contracts';
import type { McpStatusProvider } from '../provider';

type CockpitServer = Omit<McpServerDto, 'envKeys'> & { envKeys?: string[] };
interface CockpitMcpModule {
  listMcpServers(opts: { projectDirs?: string[] }): CockpitServer[];
}

// Native dynamic import (the api is compiled to CommonJS, which would turn import() into require()).
const importEsm = new Function('url', 'return import(url)') as (url: string) => Promise<unknown>;

/**
 * Wraps the existing MCP logic in agent-cockpit (src/mcp.mjs): reads Claude Code (user, local and
 * project scopes), Cursor, Claude Desktop, Codex, Gemini and Antigravity configs. Names, transport and
 * on/off only; never env values, headers or args.
 */
export class AgentCockpitMcpProvider implements McpStatusProvider {
  readonly name = 'agent-cockpit';
  private mod?: Promise<CockpitMcpModule>;

  constructor(private readonly modulePath: string) {}

  static available(modulePath: string): boolean {
    return existsSync(modulePath);
  }

  async list(projectDirs: string[]): Promise<McpServerDto[]> {
    this.mod ??= importEsm(pathToFileURL(this.modulePath).href) as Promise<CockpitMcpModule>;
    const servers = (await this.mod).listMcpServers({ projectDirs });
    return servers.map(s => ({
      id: s.id,
      name: s.name,
      client: s.client,
      scope: s.scope,
      file: s.file,
      transport: s.transport,
      target: s.target,
      enabled: s.enabled,
      envKeys: s.envKeys ?? [],
    }));
  }
}
