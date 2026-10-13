import { Module } from '@nestjs/common';
import { AgentsModule } from '@ot/mod-agents';
import { McpModule } from '@ot/mod-mcp';
import { PipelineModule } from '@ot/mod-pipeline';
import { SkillPackagesModule } from '@ot/mod-skill-packages';
import { TasksModule } from '@ot/mod-tasks';
import { TelegramModule } from '@ot/mod-telegram';
import { WorkflowModule } from '@ot/mod-workflow';
import { InfraModule } from './infra/infra.module';
import { SystemController } from './system/system.controller';

@Module({
  imports: [InfraModule, McpModule, AgentsModule, TasksModule, PipelineModule, WorkflowModule, SkillPackagesModule, TelegramModule],
  controllers: [SystemController],
})
export class AppModule {}
