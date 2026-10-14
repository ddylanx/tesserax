import type { Classification, TaskDetailDto } from '@tesserax/contracts';

export interface ClassifierContext {
  task: TaskDetailDto;
  playbooks: { id: string; name: string; appliesTo: string[]; description: string }[];
  mappedRepo: string | null;
}

export interface Classifier {
  readonly name: string;
  classify(ctx: ClassifierContext): Promise<Classification>;
}
