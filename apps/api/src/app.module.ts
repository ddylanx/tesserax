import { Module } from '@nestjs/common';
import { InfraModule } from './infra/infra.module';
import { SystemController } from './system/system.controller';

@Module({
  imports: [InfraModule],
  controllers: [SystemController],
})
export class AppModule {}
