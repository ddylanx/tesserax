import {
  Bot, FileText, GitPullRequest, MessageSquare, MessageSquareCode, ScanSearch, Sparkles, Star, Tags, TerminalSquare, Ticket, UserCheck, type LucideIcon,
} from 'lucide-react';

export interface NodeMeta {
  title: string;
  icon: LucideIcon;
  /** Tailwind classes for the icon tile and accent */
  tile: string;
  accent: string;
  group: 'Start' | 'AI' | 'You' | 'Code' | 'Delivery';
}

export const NODE_META: Record<string, NodeMeta> = {
  'trigger.jira': { title: 'Ticket', icon: Ticket, tile: 'bg-slate-500/15 text-slate-600 dark:text-slate-300', accent: 'border-l-slate-500', group: 'Start' },
  'ai.classify': { title: 'Classify', icon: Tags, tile: 'bg-indigo-500/15 text-indigo-600 dark:text-indigo-300', accent: 'border-l-indigo-500', group: 'AI' },
  'ai.step': { title: 'AI step', icon: Sparkles, tile: 'bg-violet-500/15 text-violet-600 dark:text-violet-300', accent: 'border-l-violet-500', group: 'AI' },
  'ai.review': { title: 'AI review', icon: ScanSearch, tile: 'bg-fuchsia-500/15 text-fuchsia-600 dark:text-fuchsia-300', accent: 'border-l-fuchsia-500', group: 'AI' },
  'human.gate': { title: 'You review', icon: UserCheck, tile: 'bg-amber-500/15 text-amber-600 dark:text-amber-300', accent: 'border-l-amber-500', group: 'You' },
  evaluate: { title: 'Score', icon: Star, tile: 'bg-rose-500/15 text-rose-600 dark:text-rose-300', accent: 'border-l-rose-500', group: 'You' },
  'agent.run': { title: 'Agent run', icon: Bot, tile: 'bg-sky-500/15 text-sky-600 dark:text-sky-300', accent: 'border-l-sky-500', group: 'Code' },
  'check.command': { title: 'Checks', icon: TerminalSquare, tile: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-300', accent: 'border-l-emerald-500', group: 'Code' },
  'doc.write': { title: 'Ticket doc', icon: FileText, tile: 'bg-teal-500/15 text-teal-600 dark:text-teal-300', accent: 'border-l-teal-500', group: 'Delivery' },
  'jira.comment': { title: 'Jira comment', icon: MessageSquare, tile: 'bg-blue-500/15 text-blue-600 dark:text-blue-300', accent: 'border-l-blue-500', group: 'Delivery' },
  'task.comment': { title: 'Task comment', icon: MessageSquare, tile: 'bg-blue-500/15 text-blue-600 dark:text-blue-300', accent: 'border-l-blue-500', group: 'Delivery' },
  'pr.comment': { title: 'Comment on PR', icon: MessageSquareCode, tile: 'bg-cyan-500/15 text-cyan-600 dark:text-cyan-300', accent: 'border-l-cyan-500', group: 'Delivery' },
  'git.pr': { title: 'Pull request', icon: GitPullRequest, tile: 'bg-orange-500/15 text-orange-600 dark:text-orange-300', accent: 'border-l-orange-500', group: 'Delivery' },
};

export const metaOf = (type: string): NodeMeta =>
  NODE_META[type] ?? { title: type, icon: Sparkles, tile: 'bg-muted text-muted-foreground', accent: 'border-l-border', group: 'AI' };

/** Port colours: success-ish ports green, failure-ish red, the rest neutral. */
export const portTone = (port: string) =>
  ['pass', 'approved', 'done', 'posted', 'opened', 'next', 'end'].includes(port)
    ? 'bg-emerald-500'
    : ['fail', 'failed', 'rejected'].includes(port)
      ? 'bg-red-500'
      : 'bg-amber-500';
