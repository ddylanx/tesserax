import { Handle, NodeToolbar, Position, type NodeProps, type Node } from '@xyflow/react';
import { Copy, EyeOff, Trash2 } from 'lucide-react';
import type { ReactNode } from 'react';
import type { WorkflowNode } from '@ot/contracts';
import { cn } from '@/lib/utils';
import { metaOf, portTone } from './meta';

export type NodeState = 'idle' | 'queued' | 'running' | 'waiting' | 'done' | 'failed' | 'cancelled' | 'skipped';

export type CardData = {
  node: WorkflowNode;
  ports: string[];
  /** editor */
  invalid?: boolean;
  onDuplicate?: (id: string) => void;
  onDelete?: (id: string) => void;
  /** run view */
  state?: NodeState;
  runs?: number;
  /** which ports were taken in the run */
  taken?: string[];
};

const STATE: Record<NodeState, { ring: string; badge: string; label: string }> = {
  idle: { ring: '', badge: '', label: '' },
  queued: { ring: 'ring-2 ring-sky-400/50', badge: 'bg-sky-500/15 text-sky-600', label: 'queued' },
  running: { ring: 'ring-2 ring-sky-500 animate-pulse', badge: 'bg-sky-500/15 text-sky-600', label: 'running' },
  waiting: { ring: 'ring-2 ring-amber-500', badge: 'bg-amber-500/20 text-amber-700 dark:text-amber-300', label: 'waiting for you' },
  done: { ring: 'ring-1 ring-emerald-500/60', badge: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300', label: 'done' },
  failed: { ring: 'ring-2 ring-red-500', badge: 'bg-red-500/15 text-red-600', label: 'failed' },
  cancelled: { ring: 'opacity-60', badge: 'bg-muted text-muted-foreground', label: 'cancelled' },
  skipped: { ring: 'opacity-50 border-dashed', badge: 'bg-muted text-muted-foreground', label: 'skipped' },
};

/** One card for every node type, used by the editor (editable) and the run view (with state). */
export function NodeCard({ id, data, selected }: NodeProps<Node<CardData>>) {
  const meta = metaOf(data.node.type);
  const Icon = meta.icon;
  const st = STATE[data.state ?? 'idle'];
  const subtitle = summary(data.node);
  return (
    <>
      {data.onDelete && (
        <NodeToolbar position={Position.Top} className="flex gap-1 rounded-md border bg-card p-0.5 shadow-sm">
          <ToolBtn title="Duplicate (Cmd+D)" onClick={() => data.onDuplicate?.(id)}><Copy className="size-3.5" /></ToolBtn>
          {data.node.type !== 'trigger.jira' && <ToolBtn title="Delete (Del)" onClick={() => data.onDelete?.(id)}><Trash2 className="size-3.5" /></ToolBtn>}
        </NodeToolbar>
      )}
      <div
        className={cn(
          'w-60 rounded-xl border border-l-4 bg-card shadow-sm transition-shadow',
          meta.accent, st.ring,
          selected && 'shadow-lg outline outline-2 outline-offset-2 outline-primary/70',
          data.invalid && 'border-red-500',
        )}
      >
        {data.node.type !== 'trigger.jira' && (
          <Handle type="target" position={Position.Left} className="!h-4 !w-2 !rounded-sm !border-0 !bg-muted-foreground/60" />
        )}
        <div className="flex items-start gap-2 px-3 pt-2.5">
          <div className={cn('flex size-8 shrink-0 items-center justify-center rounded-lg', meta.tile)}><Icon className="size-4" /></div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm leading-tight font-semibold">{data.node.label}</div>
            <div className="truncate text-[11px] text-muted-foreground">{meta.title}{subtitle ? ` · ${subtitle}` : ''}</div>
          </div>
        </div>
        <div className="flex flex-wrap gap-1 px-3 pt-1.5">
          {!!data.node.skipIf?.length && <Pill className="bg-muted text-muted-foreground"><EyeOff className="size-2.5" />skippable</Pill>}
          {st.label && <Pill className={st.badge}>{st.label}{data.runs && data.runs > 1 ? ` · ${data.runs}×` : ''}</Pill>}
          {data.invalid && <Pill className="bg-red-500/15 text-red-600">needs attention</Pill>}
        </div>
        <div className="mt-1.5 flex flex-col gap-0.5 border-t pt-1 pb-1.5">
          {data.ports.map(p => (
            <div key={p} className="relative flex items-center justify-end pr-4 text-[11px] text-muted-foreground">
              <span className={cn(data.taken?.includes(p) && 'font-semibold text-foreground')}>{p}</span>
              <Handle
                id={p}
                type="source"
                position={Position.Right}
                className={cn('!size-3 !border-2 !border-card', portTone(p))}
                style={{ right: -7 }}
              />
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

function Pill({ className, children }: { className?: string; children: ReactNode }) {
  return <span className={cn('inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium', className)}>{children}</span>;
}

function ToolBtn({ title, onClick, children }: { title: string; onClick: () => void; children: ReactNode }) {
  return <button title={title} onClick={onClick} className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground">{children}</button>;
}

/** One-line hint about what the node is configured to do. */
function summary(n: WorkflowNode): string {
  const c = n.config as { skill?: string; skills?: string[]; commands?: string[]; output?: string };
  if (c.skill) return c.skill.replace(/skills\/|\/SKILL\.md/g, '');
  if (c.skills?.length) return c.skills.map(s => s.replace(/skills\/|\/SKILL\.md/g, '')).join(' + ');
  if (c.commands?.length) return c.commands.at(-1)!.slice(0, 40);
  return '';
}

export const nodeTypes = { card: NodeCard };
