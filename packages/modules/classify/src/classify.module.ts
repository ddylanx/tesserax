import { Inject, Module, type OnModuleInit } from '@nestjs/common';
import type { AppConfig } from '@tesserax/config';
import { CONFIG, createLogger } from '@tesserax/core';
import { ClassificationService } from './classification.service';
import { ClaudeCliClassifier } from './claude-cli.classifier';

const log = createLogger('classify');

/** Issue classifier for Workflow. Rules engine always answers; Claude CLI goes first when configured. */
@Module({
  providers: [ClassificationService],
  exports: [ClassificationService],
})
export class ClassifyModule implements OnModuleInit {
  constructor(
    @Inject(CONFIG) private readonly config: AppConfig,
    private readonly classifier: ClassificationService,
  ) {}

  onModuleInit() {
    if (this.config.CLASSIFIER_ENGINE === 'claude-cli') {
      this.classifier.usePrimary(new ClaudeCliClassifier({ bin: this.config.CLAUDE_BIN, model: this.config.CLASSIFIER_MODEL }));
    }
    log.info({ engine: this.config.CLASSIFIER_ENGINE, bin: this.config.CLAUDE_BIN }, 'classifier');
  }
}
