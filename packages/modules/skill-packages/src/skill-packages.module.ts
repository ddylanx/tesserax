import { Module } from '@nestjs/common';
import { SkillPackagesController } from './skill-packages.controller';
import { SkillPackageStore } from './store';

@Module({
  controllers: [SkillPackagesController],
  providers: [{ provide: SkillPackageStore, useFactory: () => new SkillPackageStore() }],
  exports: [SkillPackageStore],
})
export class SkillPackagesModule {}
