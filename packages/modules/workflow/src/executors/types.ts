import type { AppConfig } from '@tesserax/config';
import type { TaskDetailDto, WorkflowNode } from '@tesserax/contracts';
import type { NodeRun, WorkflowRun } from '@tesserax/db';
import type { ClassificationService } from '@tesserax/mod-classify';
import type { TasksService } from '@tesserax/mod-tasks';
import type { WorkflowEngine } from '../engine.service';
import type { SkillCatalog } from '@tesserax/mod-skills';

export interface NodeContext {
  engine: WorkflowEngine;
  tasks: TasksService;
  classifier: ClassificationService;
  skills: SkillCatalog;
  appConfig: AppConfig;
  run: WorkflowRun;
  nodeRun: NodeRun;
  node: WorkflowNode;
  config: any; // parsed with the node type's schema
  task: TaskDetailDto;
  artifacts: Record<string, string>;
  /** Feedback from the gate that sent the work back here, if any. */
  feedback: string | null;
}

export type NodeResult =
  | {
      port: string;
      output?: Record<string, unknown>;
      artifact?: { name: string; content: string };
      costUsd?: number | null;
      numTurns?: number | null;
      skillHash?: string | null;
    }
  | { async: true }
  /** Draft ready; wait for the user's confirmation (jira.comment, git.pr). */
  | {
      wait: true;
      output?: Record<string, unknown>;
      artifact?: { name: string; content: string };
      costUsd?: number | null;
      numTurns?: number | null;
      skillHash?: string | null;
    };

/** An error that retrying will not fix (login, quota, missing repo mapping...). */
export class FatalNodeError extends Error {}

export type NodeExecutor = (ctx: NodeContext) => Promise<NodeResult>;
