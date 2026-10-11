import { join } from 'node:path';
import { Module } from '@nestjs/common';
import { findRepoRoot } from '@ot/config';
import { createLogger } from '@ot/core';
import { McpController } from './mcp.controller';
import { McpService } from './mcp.service';
import { MCP_STATUS_PROVIDER, type McpStatusProvider } from './provider';
import { AgentCockpitMcpProvider } from './providers/agent-cockpit.provider';
import { ClaudeConfigMcpProvider } from './providers/claude-config.provider';

const log = createLogger('mcp');

export function chooseMcpProvider(): McpStatusProvider {
  const cockpitPath = process.env.AGENT_COCKPIT_MCP_PATH || join(findRepoRoot(), '..', 'agent-cockpit', 'src', 'mcp.mjs');
  if (AgentCockpitMcpProvider.available(cockpitPath)) {
    log.info({ path: cockpitPath }, 'MCP provider: agent-cockpit');
    return new AgentCockpitMcpProvider(cockpitPath);
  }
  log.info('MCP provider: claude-config (agent-cockpit not found)');
  return new ClaudeConfigMcpProvider();
}

@Module({
  controllers: [McpController],
  providers: [McpService, { provide: MCP_STATUS_PROVIDER, useFactory: chooseMcpProvider }],
  exports: [McpService],
})
export class McpModule {}
