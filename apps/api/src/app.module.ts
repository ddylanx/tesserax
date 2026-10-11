import { Module } from '@nestjs/common';
import { AgentsModule } from '@ot/mod-agents';
import { McpModule } from '@ot/mod-mcp';
import { TasksModule } from '@ot/mod-tasks';
import { InfraModule } from './infra/infra.module';
import { SystemController } from './system/system.controller';

@Module({
  imports: [InfraModule, McpModule, AgentsModule, TasksModule],
  controllers: [SystemController],
})
export class AppModule {}
