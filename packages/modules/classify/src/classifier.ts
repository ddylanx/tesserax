import type { Classification, TaskDetailDto } from '@tesserax/contracts';

export interface ClassifierContext {
  task: TaskDetailDto;
  mappedRepo: string | null;
}

export interface Classifier {
  readonly name: string;
  classify(ctx: ClassifierContext): Promise<Classification>;
}
