import { BadRequestException, Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { claudeHookPayloadSchema, type AgentEventDto, type AgentSessionList } from '@tesserax/contracts';
import { AgentsService } from './agents.service';

@Controller('agents')
export class AgentsController {
  constructor(private readonly agents: AgentsService) {}

  /** Claude Code hooks POST their stdin JSON here (see scripts/claude-hooks.mjs). */
  @Post('events')
  @HttpCode(200)
  async event(@Body() body: unknown) {
    const parsed = claudeHookPayloadSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('not a Claude Code hook payload (needs hook_event_name and session_id)');
    return this.agents.ingestClaudeHook(parsed.data);
  }

  @Get('sessions')
  sessions(@Query('scope') scope?: string, @Query('project') project?: string): Promise<AgentSessionList> {
    return this.agents.listSessions(scope === 'all' ? 'all' : 'active', project || undefined);
  }

  @Get('sessions/:id/events')
  events(@Param('id', ParseUUIDPipe) id: string): Promise<AgentEventDto[]> {
    return this.agents.listEvents(id);
  }
}
