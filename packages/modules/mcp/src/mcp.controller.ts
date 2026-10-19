import { Body, Controller, Get, Param, Post, Put, Query } from '@nestjs/common';
import { updateMcpPolicySchema, type McpList, type McpPolicy, type McpServerPolicyDto, type McpToolCache } from '@tesserax/contracts';
import { McpService } from './mcp.service';

@Controller('mcp')
export class McpController {
  constructor(private readonly mcp: McpService) {}

  @Get('servers')
  list(@Query('fresh') fresh?: string): Promise<McpList> {
    return this.mcp.list(fresh === '1');
  }

  @Get('policy')
  listWithPolicy(@Query('fresh') fresh?: string): Promise<McpServerPolicyDto[]> {
    return this.mcp.listWithPolicy(fresh === '1');
  }

  @Put('policy/:server')
  updatePolicy(@Param('server') server: string, @Body() body: unknown): Promise<McpPolicy> {
    const dto = updateMcpPolicySchema.parse(body);
    return this.mcp.updatePolicy(server, dto);
  }

  @Post('servers/:server/tools/refresh')
  refreshTools(@Param('server') server: string): Promise<McpToolCache> {
    return this.mcp.refreshTools(server);
  }
}
