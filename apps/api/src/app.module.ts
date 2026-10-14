import { Module } from '@nestjs/common';
import { findRepoRoot } from '@ot/config';
import { createLogger } from '@ot/core';
import { AgentsModule } from '@ot/mod-agents';
import { McpModule } from '@ot/mod-mcp';
import { PipelineModule } from '@ot/mod-pipeline';
import { ReposModule } from '@ot/mod-repos';
import { SkillsModule } from '@ot/mod-skills';
import { TasksModule } from '@ot/mod-tasks';
import { TelegramModule } from '@ot/mod-telegram';
import { WorkflowModule, WorkflowStore } from '@ot/mod-workflow';
import { InfraModule } from './infra/infra.module';
import { SystemController } from './system/system.controller';

const root = findRepoRoot();

@Module({
  imports: [
    InfraModule,
    McpModule,
    AgentsModule,
    TasksModule,
    PipelineModule,
    SkillsModule.forRoot({ rootDir: root, usedBy: prefix => new WorkflowStore().referencing(prefix), logger: createLogger('skills') }),
    WorkflowModule,
    ReposModule,
    TelegramModule,
  ],
  controllers: [SystemController],
})
export class AppModule {}
