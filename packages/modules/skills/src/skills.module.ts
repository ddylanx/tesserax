import { type DynamicModule, Module } from '@nestjs/common';
import { SkillCatalog } from './catalog';
import { LocalSkillStore } from './local-store';
import { SKILLS_OPTIONS, type SkillsModuleOptions } from './options';
import { gitFetcher, SkillPackageStore } from './package-store';
import { SkillPackagesController } from './skill-packages.controller';
import { SkillsController } from './skills.controller';

/** Register once in the host's root module: SkillsModule.forRoot({ rootDir, usedBy, logger }). Global: SkillCatalog is injectable everywhere. */
@Module({})
export class SkillsModule {
  static forRoot(options: SkillsModuleOptions): DynamicModule {
    const dir = options.skillsDir ?? 'skills';
    const local = new LocalSkillStore(options.rootDir, dir);
    const packages = new SkillPackageStore(options.rootDir, options.fetcher ?? gitFetcher, options.usedBy, dir);
    return {
      module: SkillsModule,
      global: true,
      controllers: [SkillsController, SkillPackagesController],
      providers: [
        { provide: SKILLS_OPTIONS, useValue: options },
        { provide: LocalSkillStore, useValue: local },
        { provide: SkillPackageStore, useValue: packages },
        { provide: SkillCatalog, useValue: new SkillCatalog(local, packages) },
      ],
      exports: [SkillCatalog, LocalSkillStore, SkillPackageStore],
    };
  }
}
