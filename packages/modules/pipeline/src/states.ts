import type { PipelineState } from '@tesserax/db';

/** Allowed transitions. Every change goes through PipelineService.transition (UPDATE … WHERE state IN expected). */
export const TRANSITIONS: Record<PipelineState, readonly PipelineState[]> = {
  new: ['classifying', 'cancelled'],
  classifying: ['awaiting_decision', 'failed', 'cancelled'],
  awaiting_decision: ['queued', 'rejected', 'classifying', 'cancelled'],
  queued: ['running_playbook', 'failed', 'cancelled'],
  running_playbook: ['awaiting_verify', 'failed', 'cancelled'],
  awaiting_verify: ['verified_true', 'verified_false', 'queued', 'cancelled'],
  failed: ['classifying', 'queued', 'cancelled'],
  rejected: [],
  verified_true: [],
  verified_false: [],
  cancelled: [],
};

export const canTransition = (from: PipelineState, to: PipelineState) => TRANSITIONS[from].includes(to);

export const STATE_GROUPS: Record<string, PipelineState[]> = {
  decide: ['awaiting_decision'],
  running: ['new', 'classifying', 'queued', 'running_playbook'],
  verify: ['awaiting_verify'],
  failed: ['failed'],
  done: ['rejected', 'verified_true', 'verified_false', 'cancelled'],
};

/** Pipeline steps: each is a pg-boss queue; jobs are keyed (run_id, step, attempt). */
export const STEPS = {
  classify: { queue: 'pipeline.classify', state: 'classifying' as PipelineState },
  run: { queue: 'pipeline.run-playbook', state: 'queued' as PipelineState },
  finalize: { queue: 'pipeline.finalize', state: 'running_playbook' as PipelineState },
} as const;
export type StepName = keyof typeof STEPS;

export interface StepJobData {
  runId: string;
  attempt: number;
}

export const STEP_RETRY = { retryLimit: 3, retryDelay: 5, retryBackoff: true };

export class TransitionConflict extends Error {
  constructor(readonly runId: string, readonly expected: readonly PipelineState[], readonly actual: PipelineState | null) {
    super(actual ? `Run is ${actual}, expected ${expected.join(' or ')}` : 'Run not found');
  }
}
