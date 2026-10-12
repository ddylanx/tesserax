import { Search } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { NodeType } from '@ot/contracts';
import { cn } from '@/lib/utils';
import { metaOf } from './meta';

export interface NodeTypeOption {
  type: NodeType;
  title: string;
  description: string;
}

/** Searchable list of node types, grouped like n8n's node panel. Used by the palette and the pop-up menu. */
export function NodeTypeList({ options, onPick, draggable, autoFocus }: {
  options: NodeTypeOption[]; onPick: (t: NodeType) => void; draggable?: boolean; autoFocus?: boolean;
}) {
  const [q, setQ] = useState('');
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { if (autoFocus) ref.current?.focus(); }, [autoFocus]);
  const groups = useMemo(() => {
    const f = options.filter(o => o.type !== 'trigger.jira' && `${o.title} ${o.description} ${o.type}`.toLowerCase().includes(q.toLowerCase()));
    const by = new Map<string, NodeTypeOption[]>();
    for (const o of f) by.set(metaOf(o.type).group, [...(by.get(metaOf(o.type).group) ?? []), o]);
    return [...by];
  }, [options, q]);
  return (
    <div className="flex min-h-0 flex-col gap-2">
      <label className="flex items-center gap-1.5 rounded-md border bg-background px-2">
        <Search className="size-3.5 text-muted-foreground" />
        <input ref={ref} className="h-8 w-full bg-transparent text-sm outline-none" placeholder="Search nodes…" value={q} onChange={e => setQ(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && groups[0]?.[1][0]) onPick(groups[0][1][0].type); }} />
      </label>
      <div className="flex min-h-0 flex-col gap-2 overflow-y-auto">
        {groups.map(([group, items]) => (
          <div key={group}>
            <div className="px-1 pb-1 text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">{group}</div>
            {items.map(o => {
              const m = metaOf(o.type);
              const Icon = m.icon;
              return (
                <button
                  key={o.type}
                  draggable={draggable}
                  onDragStart={e => { e.dataTransfer.setData('application/ot-node', o.type); e.dataTransfer.effectAllowed = 'move'; }}
                  onClick={() => onPick(o.type)}
                  title={o.description}
                  className={cn('flex w-full items-start gap-2 rounded-md px-1.5 py-1.5 text-left hover:bg-accent', draggable && 'cursor-grab active:cursor-grabbing')}
                >
                  <span className={cn('flex size-7 shrink-0 items-center justify-center rounded-md', m.tile)}><Icon className="size-3.5" /></span>
                  <span className="min-w-0">
                    <span className="block text-xs font-medium">{o.title}</span>
                    <span className="line-clamp-2 block text-[11px] text-muted-foreground">{o.description}</span>
                  </span>
                </button>
              );
            })}
          </div>
        ))}
        {groups.length === 0 && <p className="px-1 text-xs text-muted-foreground">No node matches.</p>}
      </div>
    </div>
  );
}

/** Floating menu at screen coordinates (after "+" on an edge, or dropping a connection on empty canvas). */
export function NodeMenu({ x, y, options, onPick, onClose }: { x: number; y: number; options: NodeTypeOption[]; onPick: (t: NodeType) => void; onClose: () => void }) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);
  const left = Math.min(x, window.innerWidth - 300);
  const top = Math.min(y, window.innerHeight - 380);
  return (
    <div className="fixed inset-0 z-50" onMouseDown={onClose}>
      <div className="absolute flex max-h-96 w-72 flex-col rounded-xl border bg-card p-2 shadow-xl" style={{ left, top }} onMouseDown={e => e.stopPropagation()}>
        <NodeTypeList options={options} onPick={onPick} autoFocus />
      </div>
    </div>
  );
}
