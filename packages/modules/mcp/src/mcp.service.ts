import { Inject, Injectable } from '@nestjs/common';
import type { McpList } from '@tesserax/contracts';
import { MCP_STATUS_PROVIDER, type McpStatusProvider } from './provider';

/** Extra project folders to scan (e.g. where agents ran). */
export type ProjectDirsSource = () => Promise<string[]>;

@Injectable()
export class McpService {
  private cache?: { at: number; value: McpList };
  private projectDirSources: ProjectDirsSource[] = [];

  constructor(@Inject(MCP_STATUS_PROVIDER) private readonly provider: McpStatusProvider) {}

  addProjectDirsSource(source: ProjectDirsSource) {
    this.projectDirSources.push(source);
  }

  async list(fresh = false): Promise<McpList> {
    if (!fresh && this.cache && Date.now() - this.cache.at < 10_000) return this.cache.value;
    const dirs = (await Promise.all(this.projectDirSources.map(s => s().catch(() => [])))).flat();
    const servers = await this.provider.list([...new Set(dirs)]);
    servers.sort((a, b) => Number(b.enabled) - Number(a.enabled) || a.name.localeCompare(b.name) || a.client.localeCompare(b.client));
    const value: McpList = { provider: this.provider.name, generatedAt: new Date().toISOString(), servers };
    this.cache = { at: Date.now(), value };
    return value;
  }
}
