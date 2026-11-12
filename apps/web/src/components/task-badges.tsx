import { AlertCircle, Bookmark, Bug, CheckSquare, Flame, GitPullRequest } from 'lucide-react';
import { Tag } from '@/components/ui/status-pill';

// Type and priority are labels, not states: neutral tags, only the icon carries color.
const tag = 'gap-1 px-1.5 py-0 text-[10px] font-medium';

export function renderTypeBadge(type: string | null) {
  if (!type) return null;
  const t = type.toLowerCase();
  if (t === 'bug') return <Tag className={tag}><Bug className="size-2.5 text-destructive" /> Bug</Tag>;
  if (t === 'story') return <Tag className={tag}><Bookmark className="size-2.5 text-success" /> Story</Tag>;
  if (t === 'code review') return <Tag className={tag}><GitPullRequest className="size-2.5 text-purple-600 dark:text-purple-400" /> Review</Tag>;
  return <Tag className={tag}><CheckSquare className="size-2.5" /> {type}</Tag>;
}

export function renderPriorityBadge(priority: string | null) {
  if (!priority) return <span className="text-xs text-muted-foreground">–</span>;
  const p = priority.toLowerCase();
  if (p.includes('high') || p.includes('crit') || p.includes('block')) {
    return <Tag className="gap-1 px-1.5 py-0 text-[11px] font-medium text-foreground"><Flame className="size-3 text-destructive" />{priority}</Tag>;
  }
  if (p.includes('med')) return <Tag className="gap-1 px-1.5 py-0 text-[11px]"><AlertCircle className="size-3 text-warning" />{priority}</Tag>;
  return <Tag className="px-1.5 py-0 text-[11px]">{priority}</Tag>;
}
