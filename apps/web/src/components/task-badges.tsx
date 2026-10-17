import { AlertCircle, Bookmark, Bug, CheckSquare, Flame, GitPullRequest } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

export function renderTypeBadge(type: string | null) {
  if (!type) return null;
  const t = type.toLowerCase();
  if (t === 'bug') {
    return (
      <Badge variant="red" className="text-[10px] font-medium gap-1 px-1.5 py-0">
        <Bug className="size-2.5" /> Bug
      </Badge>
    );
  }
  if (t === 'story') {
    return (
      <Badge variant="green" className="text-[10px] font-medium gap-1 px-1.5 py-0">
        <Bookmark className="size-2.5" /> Story
      </Badge>
    );
  }
  if (t === 'code review') {
    return (
      <Badge variant="purple" className="text-[10px] font-medium gap-1 px-1.5 py-0">
        <GitPullRequest className="size-2.5" /> Review
      </Badge>
    );
  }
  return (
    <Badge variant="slate" className="text-[10px] font-medium gap-1 px-1.5 py-0">
      <CheckSquare className="size-2.5" /> {type}
    </Badge>
  );
}

export function renderPriorityBadge(priority: string | null) {
  if (!priority) return <span className="text-xs text-muted-foreground">–</span>;
  const p = priority.toLowerCase();
  if (p.includes('high') || p.includes('crit') || p.includes('block')) {
    return (
      <Badge variant="red" className="text-[11px] font-semibold gap-1 px-1.5 py-0.5">
        <Flame className="size-3 text-rose-500" />
        {priority}
      </Badge>
    );
  }
  if (p.includes('med')) {
    return (
      <Badge variant="amber" className="text-[11px] font-medium gap-1 px-1.5 py-0.5">
        <AlertCircle className="size-3 text-amber-500" />
        {priority}
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="text-[11px] text-muted-foreground px-1.5 py-0.5">
      {priority}
    </Badge>
  );
}
