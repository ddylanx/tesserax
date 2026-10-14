import { Injectable } from '@nestjs/common';
import { createLogger } from '@tesserax/core';
import type { Classification } from '@tesserax/contracts';
import type { Classifier, ClassifierContext } from './classifier';
import { RulesClassifier } from './rules.classifier';

const log = createLogger('pipeline.classify');

/** Tries each engine in order; the rules engine always answers. */
@Injectable()
export class ClassificationService {
  private engines: Classifier[] = [new RulesClassifier()];

  /** Put an engine in front of the rules fallback. */
  usePrimary(engine: Classifier) {
    this.engines = [engine, ...this.engines.filter(e => e.name !== engine.name)];
  }

  async classify(ctx: ClassifierContext): Promise<{ classification: Classification; engine: string; fallbackReason?: string }> {
    let fallbackReason: string | undefined;
    for (const engine of this.engines) {
      try {
        const classification = await engine.classify(ctx);
        // Only playbooks that exist; the repo comes from config/repos.json, not from the issue text.
        if (classification.playbook && !ctx.playbooks.some(p => p.id === classification.playbook)) classification.playbook = null;
        classification.repo = ctx.mappedRepo;
        return { classification, engine: engine.name, fallbackReason };
      } catch (err) {
        fallbackReason = `${engine.name}: ${String((err as Error).message ?? err).slice(0, 300)}`;
        log.warn({ engine: engine.name, err: fallbackReason }, 'classifier failed, trying next');
      }
    }
    throw new Error(`No classifier answered (${fallbackReason})`);
  }
}
