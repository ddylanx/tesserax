import { Module } from '@nestjs/common';
import { createLogger } from '@tesserax/core';
import { McpController } from './mcp.controller';
import { McpService } from './mcp.service';
import { MCP_STATUS_PROVIDER, type McpStatusProvider } from './provider';
import { BuiltinMcpProvider } from './providers/builtin.provider';

const log = createLogger('mcp');

export function chooseMcpProvider(): McpStatusProvider {
  log.info('MCP provider: builtin');
  return new BuiltinMcpProvider();
}

@Module({
  controllers: [McpController],
  providers: [McpService, { provide: MCP_STATUS_PROVIDER, useFactory: chooseMcpProvider }],
  exports: [McpService],
})
export class McpModule {}
