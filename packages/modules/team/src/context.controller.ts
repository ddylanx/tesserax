import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import type { ContextOverview, ContextPack, Improvement, RoleContext, RoleContextText } from '@tesserax/contracts';
import { ContextService } from './context.service';

/** Context page: packs, which role reads which, and the proposals roles make to do their job better. Bodies are validated by ContextService. */
@Controller('team')
export class ContextController {
  constructor(private readonly context: ContextService) {}

  @Get('context')
  overview(): Promise<ContextOverview> {
    return this.context.overview();
  }

  @Put('context/packs/:slug')
  savePack(@Param('slug') slug: string, @Body() body: unknown): Promise<ContextPack> {
    return this.context.savePack(slug, body);
  }

  @Delete('context/packs/:slug')
  @HttpCode(200)
  async deletePack(@Param('slug') slug: string) {
    await this.context.deletePack(slug);
    return { ok: true };
  }

  @Get('context/roles/:id')
  roleText(@Param('id', ParseUUIDPipe) id: string): Promise<RoleContextText> {
    return this.context.roleText(id);
  }

  @Put('context/roles/:id')
  setRoleContext(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown): Promise<RoleContext> {
    return this.context.setRoleContext(id, body);
  }

  @Get('improvements')
  async improvements(@Query('status') status?: string, @Query('role') role?: string): Promise<{ improvements: Improvement[] }> {
    return { improvements: await this.context.improvements({ status, role }) };
  }

  @Post('roles/:id/improvements')
  propose(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown): Promise<Improvement> {
    return this.context.propose(id, body);
  }

  @Post('improvements/:id/decision')
  @HttpCode(200)
  decide(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown): Promise<Improvement> {
    return this.context.decide(id, body);
  }
}
