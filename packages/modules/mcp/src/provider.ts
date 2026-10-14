import type { McpServerDto } from '@tesserax/contracts';

/** Where the MCP server list comes from. Read-only: never starts, stops or edits servers. */
export interface McpStatusProvider {
  readonly name: string;
  /** @param projectDirs extra project folders to look in (e.g. where agents have run) */
  list(projectDirs: string[]): Promise<McpServerDto[]>;
}

export const MCP_STATUS_PROVIDER = Symbol('MCP_STATUS_PROVIDER');
