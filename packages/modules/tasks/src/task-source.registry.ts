import { Inject, Injectable } from '@nestjs/common';
import type { TaskSource } from '@tesserax/contracts';
import { TASK_SOURCES } from '@tesserax/core';

@Injectable()
export class TaskSourceRegistry {
  private readonly sources = new Map<string, TaskSource>();
  private readonly list: TaskSource[];

  constructor(@Inject(TASK_SOURCES) sources: TaskSource[]) {
    this.list = Array.isArray(sources) ? sources : [];
    for (const source of this.list) {
      this.sources.set(source.kind, source);
    }
  }

  get(kind: string): TaskSource | null {
    return this.sources.get(kind) ?? null;
  }

  all(): TaskSource[] {
    return [...this.list];
  }
}
