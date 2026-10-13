import { Module } from '@nestjs/common';
import { ReposController } from './repos.controller';
import { RepoRegistryStore, repoRegistry } from './store';

@Module({
  controllers: [ReposController],
  providers: [{ provide: RepoRegistryStore, useValue: repoRegistry }],
  exports: [RepoRegistryStore],
})
export class ReposModule {}
