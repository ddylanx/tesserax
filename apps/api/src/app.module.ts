import { Module } from '@nestjs/common';
import { AgentsModule } from '@ot/mod-agents';
import { McpModule } from '@ot/mod-mcp';
import { PipelineModule } from '@ot/mod-pipeline';
import { TasksModule } from '@ot/mod-tasks';
import { TelegramModule } from '@ot/mod-telegram';
import { InfraModule } from './infra/infra.module';
import { SystemController } from './system/system.controller';

@Module({
  imports: [InfraModule, McpModule, AgentsModule, TasksModule, PipelineModule, TelegramModule],
  controllers: [SystemController],
})
export class AppModule {}
