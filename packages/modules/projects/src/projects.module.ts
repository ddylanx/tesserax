import { Global, Module } from '@nestjs/common';
import { PROJECT_DIRECTORY } from '@tesserax/core';
import { ReposModule } from '@tesserax/mod-repos';
import { ProjectsController } from './projects.controller';
import { ProjectsService } from './projects.service';

/** Global so tasks, workflow and agents can inject PROJECT_DIRECTORY without importing this module's internals. */
@Global()
@Module({
  imports: [ReposModule],
  controllers: [ProjectsController],
  providers: [ProjectsService, { provide: PROJECT_DIRECTORY, useExisting: ProjectsService }],
  exports: [ProjectsService, PROJECT_DIRECTORY],
})
export class ProjectsModule {}
