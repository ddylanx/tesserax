import type { AppConfig } from '@ot/config';
import type { TaskDetailDto, WorkflowNode } from '@ot/contracts';
import type { NodeRun, WorkflowRun } from '@ot/db';
import type { TasksService } from '@ot/mod-tasks';
import type { WorkflowEngine } from '../engine.service';
import type { SkillStore } from '../stores';

export interface NodeContext {
  engine: WorkflowEngine;
  tasks: TasksService;
  skills: SkillStore;
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
