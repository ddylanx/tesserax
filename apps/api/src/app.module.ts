import { Module } from '@nestjs/common';
import { McpModule } from '@ot/mod-mcp';
import { InfraModule } from './infra/infra.module';
import { SystemController } from './system/system.controller';

@Module({
  imports: [InfraModule, McpModule],
  controllers: [SystemController],
})
export class AppModule {}
