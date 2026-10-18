import { Module } from '@nestjs/common';
import { findRepoRoot } from '@tesserax/config';
import { createLogger } from '@tesserax/core';
import { AgentsModule } from '@tesserax/mod-agents';
import { McpModule } from '@tesserax/mod-mcp';
import { ProjectsModule } from '@tesserax/mod-projects';
import { ReposModule } from '@tesserax/mod-repos';
import { SkillsModule } from '@tesserax/mod-skills';
import { TasksModule } from '@tesserax/mod-tasks';
import { TelegramModule } from '@tesserax/mod-telegram';
import { WorkflowModule, WorkflowStore } from '@tesserax/mod-workflow';
import { InfraModule } from './infra/infra.module';
import { SystemController } from './system/system.controller';

const root = findRepoRoot();

@Module({
  imports: [
    InfraModule,
    McpModule,
    AgentsModule,
    TasksModule,
    SkillsModule.forRoot({ rootDir: root, usedBy: prefix => new WorkflowStore().referencing(prefix), logger: createLogger('skills') }),
    WorkflowModule,
    ReposModule,
    ProjectsModule,
    TelegramModule,
  ],
  controllers: [SystemController],
})
export class AppModule {}
