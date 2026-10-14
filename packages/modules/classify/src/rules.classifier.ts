import type { Classification } from '@tesserax/contracts';
import type { Classifier, ClassifierContext } from './classifier';

/** Deterministic fallback: issue type, labels and title only. */
export class RulesClassifier implements Classifier {
  readonly name = 'rules';

  async classify({ task, playbooks, mappedRepo }: ClassifierContext): Promise<Classification> {
    const issueType = (task.type ?? '').toLowerCase();
    const labels = task.labels.map(l => l.toLowerCase());
    let type: Classification['type'];
    if (/review/.test(issueType) || labels.includes('review') || labels.includes('code-review')) type = 'review';
    else if (issueType === 'bug' || labels.includes('bug')) type = 'bug';
    else if (/spike|research/.test(issueType) || labels.includes('research')) type = 'research';
    else if (labels.includes('question') || task.title.trim().endsWith('?')) type = 'question';
    else if (/story|feature|improvement|epic/.test(issueType)) type = 'feature';
    else type = 'chore';

    const automation: Classification['automation'] =
      type === 'question' || type === 'research' || type === 'review' ? 'auto' : type === 'bug' || type === 'feature' ? 'assisted' : 'manual';
    const preferred = ({ bug: 'investigate-bug', question: 'research-question', research: 'research-question', feature: null, chore: null, review: null } as const)[type];
    const playbook = preferred && playbooks.some(p => p.id === preferred) ? preferred : playbooks.find(p => p.appliesTo.includes(type))?.id ?? null;

    return {
      type,
      automation,
      playbook,
      repo: mappedRepo,
      confidence: 0.4,
      reasoning: `Rules: issue type "${task.type ?? 'none'}"${labels.length ? `, labels ${labels.join(', ')}` : ''}${type === 'question' && !labels.includes('question') ? ', title is a question' : ''}.`,
    };
  }
}
