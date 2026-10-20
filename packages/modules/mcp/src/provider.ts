import type { McpServerDto } from '@tesserax/contracts';

export type RawServerDefinition = {
  command?: string;
  args?: string[];
  env?: Record<string, unknown>;
  url?: string;
  type?: string;
  disabled?: boolean;
  [key: string]: unknown;
};

export type FullMcpServer = McpServerDto & {
  definition: Record<string, unknown>;
};

/** Where the MCP server list comes from. Read-only: never starts, stops or edits servers. */
export interface McpStatusProvider {
  readonly name: string;
  /** @param projectDirs extra project folders to look in (e.g. where agents have run) */
  list(projectDirs: string[]): Promise<McpServerDto[]>;
  listFull(projectDirs: string[]): Promise<FullMcpServer[]>;
}

export const MCP_STATUS_PROVIDER = Symbol('MCP_STATUS_PROVIDER');

