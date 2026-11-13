import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import type { Department, Role, RoleChange, TeamList } from '@tesserax/contracts';
import { TeamService } from './team.service';

/** Team page: departments and the roles (sub agent setups) in them. Bodies are validated by TeamService with the contract schemas. */
@Controller('team')
export class TeamController {
  constructor(private readonly team: TeamService) {}

  @Get()
  list(@Query('project') project?: string): Promise<TeamList> {
    return this.team.list({ projectSlug: project || null });
  }

  @Post('departments')
  createDepartment(@Body() body: unknown): Promise<Department> {
    return this.team.createDepartment(body);
  }

  @Patch('departments/:id')
  updateDepartment(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown): Promise<Department> {
    return this.team.updateDepartment(id, body);
  }

  @Delete('departments/:id')
  @HttpCode(200)
  async deleteDepartment(@Param('id', ParseUUIDPipe) id: string) {
    await this.team.deleteDepartment(id);
    return { ok: true };
  }

  @Post('roles')
  createRole(@Body() body: unknown): Promise<Role> {
    return this.team.createRole(body);
  }

  @Patch('roles/:id')
  updateRole(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown): Promise<Role> {
    return this.team.updateRole(id, body);
  }

  @Delete('roles/:id')
  @HttpCode(200)
  async deleteRole(@Param('id', ParseUUIDPipe) id: string) {
    await this.team.deleteRole(id);
    return { ok: true };
  }

  @Get('roles/:id/changes')
  async changes(@Param('id', ParseUUIDPipe) id: string): Promise<{ changes: RoleChange[] }> {
    return { changes: await this.team.changes(id) };
  }
}
