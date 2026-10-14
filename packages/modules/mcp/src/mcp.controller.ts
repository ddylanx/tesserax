import { Controller, Get, Query } from '@nestjs/common';
import type { McpList } from '@tesserax/contracts';
import { McpService } from './mcp.service';

@Controller('mcp')
export class McpController {
  constructor(private readonly mcp: McpService) {}

  @Get('servers')
  list(@Query('fresh') fresh?: string): Promise<McpList> {
    return this.mcp.list(fresh === '1');
  }
}
