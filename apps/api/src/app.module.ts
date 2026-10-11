import { Module } from '@nestjs/common';
import { AgentsModule } from '@ot/mod-agents';
import { McpModule } from '@ot/mod-mcp';
import { InfraModule } from './infra/infra.module';
import { SystemController } from './system/system.controller';

@Module({
  imports: [InfraModule, McpModule, AgentsModule],
  controllers: [SystemController],
})
export class AppModule {}
