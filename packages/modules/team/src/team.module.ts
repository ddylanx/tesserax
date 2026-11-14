import { type DynamicModule, Module } from '@nestjs/common';
import type { ProjectDirectory, WorkflowUsage } from '@tesserax/contracts';
import { DB, PROJECT_DIRECTORY, ROLE_LOOKUP, WORKFLOW_USAGE } from '@tesserax/core';
import type { Db } from '@tesserax/db';
import { ContextController } from './context.controller';
import { KyselyContextRepo } from './context.repo';
import { ContextService } from './context.service';
import { TeamController } from './team.controller';
import { KyselyTeamRepo } from './team.repo';
import { TeamService } from './team.service';

export interface TeamModuleOptions {
  /** Which workflows name a role (the workflow module's store), so a used role cannot be renamed or deleted. */
  workflowUsage: WorkflowUsage;
}

/**
 * Register once in the host's root module: TeamModule.forRoot({ workflowUsage }). Global: ROLE_LOOKUP is injectable everywhere
 * (the workflow engine reads roles through it, never through this module's internals).
 */
@Module({})
export class TeamModule {
  static forRoot(options: TeamModuleOptions): DynamicModule {
    return {
      module: TeamModule,
      global: true,
      controllers: [TeamController, ContextController],
      providers: [
        { provide: WORKFLOW_USAGE, useValue: options.workflowUsage },
        {
          provide: TeamService,
          useFactory: (db: Db, usage: WorkflowUsage, projects: ProjectDirectory) => new TeamService(new KyselyTeamRepo(db), usage, projects),
          inject: [DB, WORKFLOW_USAGE, PROJECT_DIRECTORY],
        },
        { provide: ContextService, useFactory: (db: Db, team: TeamService) => new ContextService(new KyselyContextRepo(db), team), inject: [DB, TeamService] },
        // a role by key comes with its context (packs + approved lessons), and takes the proposals a step ends with
        { provide: ROLE_LOOKUP, useExisting: ContextService },
      ],
      exports: [TeamService, ContextService, ROLE_LOOKUP],
    };
  }
}
