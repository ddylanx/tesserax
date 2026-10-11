import type { JobMeta } from '@ot/core';
import type { TasksService } from '@ot/mod-tasks';
import type { ClassificationService } from '../classify/classification.service';
import type { PipelineService } from '../pipeline.service';
import type { PlaybookRegistry } from '../playbooks';
import type { StepJobData } from '../states';

/** classifying -> awaiting_decision, with the classification stored on the run. */
export async function runClassifyJob(
  deps: { pipeline: PipelineService; tasks: TasksService; classifier: ClassificationService; playbooks: PlaybookRegistry },
  data: StepJobData,
  meta: JobMeta,
) {
  await deps.pipeline.runStep('classify', ['classifying'], data, meta, async run => {
    await deps.tasks.ensureDetail(run.task_id).catch(() => undefined); // comments help; not required
    const task = await deps.tasks.getTask(run.task_id);
    if (!task) throw new Error('Task no longer exists');
    const playbooks = deps.playbooks.list().map(p => ({ id: p.id, name: p.name, appliesTo: p.appliesTo, description: p.description }));
    const { classification, engine, fallbackReason } = await deps.classifier.classify({
      task, playbooks, mappedRepo: deps.pipeline.repos.forProject(task.project),
    });
    await deps.pipeline.transition(run.id, {
      from: 'classifying',
      to: 'awaiting_decision',
      actor: 'job',
      action: 'classified',
      patch: { classification: JSON.stringify(classification), classification_engine: engine },
      detail: { engine, type: classification.type, automation: classification.automation, playbook: classification.playbook, confidence: classification.confidence, ...(fallbackReason ? { fallbackReason } : {}) },
    });
  });
}
