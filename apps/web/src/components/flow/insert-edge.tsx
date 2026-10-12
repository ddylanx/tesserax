import { BaseEdge, EdgeLabelRenderer, getBezierPath, type Edge, type EdgeProps } from '@xyflow/react';
import { Plus } from 'lucide-react';
import { cn } from '@/lib/utils';

export type InsertEdgeData = { port: string; maxLoops?: number; onLimit?: string; onInsert?: (edgeId: string, x: number, y: number) => void; taken?: boolean; dim?: boolean };

/** Edge with its port label and, in the editor, a "+" to insert a node in between (n8n style). */
export function InsertEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data, selected, markerEnd, style }: EdgeProps<Edge<InsertEdgeData>>) {
  const [path, labelX, labelY] = getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition });
  const back = targetX < sourceX; // loops drawn dashed
  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        markerEnd={markerEnd}
        style={{ ...style, strokeWidth: selected || data?.taken ? 2.5 : 1.5, strokeDasharray: back ? '6 4' : undefined, opacity: data?.dim ? 0.35 : 1 }}
      />
      <EdgeLabelRenderer>
        <div
          className="nodrag nopan pointer-events-auto absolute flex items-center gap-1"
          style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
        >
          <span className={cn('rounded border bg-card px-1.5 py-0.5 text-[10px] text-muted-foreground shadow-sm', selected && 'border-primary text-foreground')}>
            {data?.port}{data?.maxLoops ? ` · max ${data.maxLoops}` : ''}
          </span>
          {data?.onInsert && (
            <button
              title="Insert a node here"
              className="flex size-5 items-center justify-center rounded-full border bg-card text-muted-foreground shadow-sm hover:border-primary hover:text-foreground"
              onClick={e => data.onInsert!(id, e.clientX, e.clientY)}
            >
              <Plus className="size-3" />
            </button>
          )}
        </div>
      </EdgeLabelRenderer>
    </>
  );
}

export const edgeTypes = { insert: InsertEdge };
