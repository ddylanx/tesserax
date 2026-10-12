import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from '@tanstack/react-router';
import {
  Background, Controls, Handle, MiniMap, Position, ReactFlow, addEdge, useEdgesState, useNodesState,
  type Connection, type Edge, type Node, type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { AlertTriangle, Plus, Save, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { validateWorkflow, type NodeType, type WorkflowDefinition, type WorkflowEdge, type WorkflowNode } from '@ot/contracts';
import { QueryState } from '@/components/page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/input';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';

interface NodeTypeInfo {
  type: NodeType;
  title: string;
  description: string;
  ports: string[];
  schema: { properties?: Record<string, JsonProp>; required?: string[] };
}
interface JsonProp {
  type?: string | string[];
  enum?: string[];
  items?: { type?: string };
  default?: unknown;
  description?: string;
  anyOf?: JsonProp[];
}
interface SkillInfo { path: string; name: string; description: string }

const TYPE_COLOR: Record<string, string> = {
  'trigger.jira': 'border-slate-400', 'ai.step': 'border-violet-500', 'human.gate': 'border-amber-500', 'agent.run': 'border-sky-500',
  'check.command': 'border-emerald-500', 'ai.review': 'border-fuchsia-500', evaluate: 'border-rose-500',
};

type EditorData = { node: WorkflowNode; info?: NodeTypeInfo; invalid: boolean };

function EditorNode({ data, selected }: NodeProps<Node<EditorData>>) {
  const ports = data.info?.ports ?? [];
  return (
    <div className={cn('w-48 rounded-lg border-2 bg-card px-3 pt-2 pb-1 shadow-sm', TYPE_COLOR[data.node.type], selected && 'ring-2 ring-primary', data.invalid && 'border-red-500')}>
      {data.node.type !== 'trigger.jira' && <Handle type="target" position={Position.Left} className="!size-3 !bg-muted-foreground" />}
      <div className="text-[10px] tracking-wide text-muted-foreground uppercase">{data.info?.title ?? data.node.type}</div>
      <div className="text-sm leading-tight font-medium">{data.node.label}</div>
      <div className="mt-1 flex flex-col items-end gap-1">
        {ports.map(p => (
          <div key={p} className="relative pr-2 text-[10px] text-muted-foreground">
            {p}
            <Handle id={p} type="source" position={Position.Right} className="!size-2.5 !bg-primary" style={{ right: -14 }} />
          </div>
        ))}
      </div>
    </div>
  );
}
const nodeTypes = { step: EditorNode };

const toFlowEdge = (e: WorkflowEdge): Edge => ({
  id: e.id, source: e.source, target: e.target, sourceHandle: e.port,
  label: `${e.port}${e.maxLoops ? ` · max ${e.maxLoops}` : ''}`, data: { maxLoops: e.maxLoops, onLimit: e.onLimit }, labelStyle: { fontSize: 10 },
});

export function WorkflowEditorPage() {
  const { workflowId } = useParams({ strict: false }) as { workflowId: string };
  const qc = useQueryClient();
  const wf = useQuery({ queryKey: ['wf', 'def', workflowId], queryFn: () => api<{ def: WorkflowDefinition; hash: string }>(`/api/workflows/${workflowId}`) });
  const types = useQuery({ queryKey: ['wf', 'node-types'], queryFn: () => api<NodeTypeInfo[]>('/api/node-types') });
  const skills = useQuery({ queryKey: ['skills'], queryFn: () => api<SkillInfo[]>('/api/skills') });
  const info = useMemo(() => new Map((types.data ?? []).map(t => [t.type, t])), [types.data]);

  const [meta, setMeta] = useState<{ id: string; name: string; description: string } | null>(null);
  const [nodes, setNodes, onNodesChange] = useNodesState<Node<EditorData>>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [sel, setSel] = useState<{ kind: 'node' | 'edge'; id: string } | null>(null);
  const [dirty, setDirty] = useState(false);

  // load once per workflow
  useEffect(() => {
    if (!wf.data || meta?.id === wf.data.def.id) return;
    const d = wf.data.def;
    setMeta({ id: d.id, name: d.name, description: d.description });
    setNodes(d.nodes.map(n => ({ id: n.id, type: 'step', position: n.position, data: { node: n, invalid: false } })));
    setEdges(d.edges.map(toFlowEdge));
    setDirty(false);
  }, [wf.data, meta?.id, setNodes, setEdges]);

  const definition = useMemo<WorkflowDefinition | null>(() => {
    if (!meta) return null;
    return {
      ...meta,
      nodes: nodes.map(n => ({
        ...n.data.node,
        // blank lines in list fields are only an editing convenience
        config: Object.fromEntries(Object.entries(n.data.node.config).map(([k, v]) => [k, Array.isArray(v) ? v.filter(x => x !== '') : v])),
        position: { x: Math.round(n.position.x), y: Math.round(n.position.y) },
      })),
      edges: edges.map(e => ({
        id: e.id, source: e.source, target: e.target, port: e.sourceHandle ?? 'next',
        ...((e.data as { maxLoops?: number })?.maxLoops ? { maxLoops: (e.data as { maxLoops: number }).maxLoops } : {}),
        ...((e.data as { onLimit?: string })?.onLimit ? { onLimit: (e.data as { onLimit: string }).onLimit } : {}),
      })),
    };
  }, [meta, nodes, edges]);
  const problems = useMemo(() => (definition ? validateWorkflow(definition) : []), [definition]);

  // mark nodes with problems
  useEffect(() => {
    setNodes(ns => {
      let changed = false;
      const next = ns.map(n => {
        const invalid = problems.some(p => p.includes(`"${n.data.node.label}"`));
        const i = info.get(n.data.node.type);
        if (invalid === n.data.invalid && i === n.data.info) return n;
        changed = true;
        return { ...n, data: { ...n.data, invalid, info: i } };
      });
      return changed ? next : ns; // same array when nothing changed, or this effect would loop
    });
  }, [problems, info, setNodes]);

  const save = useMutation({
    mutationFn: () => api<{ hash: string }>(`/api/workflows/${workflowId}`, { method: 'PUT', body: JSON.stringify(definition) }),
    onSuccess: () => { setDirty(false); qc.invalidateQueries({ queryKey: ['wf', 'def', workflowId] }); qc.invalidateQueries({ queryKey: ['wf', 'list'] }); },
  });

  const onConnect = useCallback((c: Connection) => {
    setEdges(es => addEdge({ ...c, id: `e${Date.now().toString(36)}`, label: c.sourceHandle ?? 'next', labelStyle: { fontSize: 10 }, data: {} }, es));
    setDirty(true);
  }, [setEdges]);

  const addNode = (type: NodeType) => {
    const t = info.get(type);
    const base = type.replace(/[^a-z]/g, '_');
    let i = 1;
    while (nodes.some(n => n.id === `${base}_${i}`)) i++;
    const id = `${base}_${i}`;
    const config = defaultsFor(t);
    const node: WorkflowNode = { id, type, label: t?.title ?? type, position: { x: 80 + nodes.length * 20, y: 360 }, config };
    setNodes(ns => [...ns, { id, type: 'step', position: node.position, data: { node, info: t, invalid: false } }]);
    setSel({ kind: 'node', id });
    setDirty(true);
  };

  const updateNode = (id: string, patch: Partial<WorkflowNode>) => {
    setNodes(ns => ns.map(n => (n.id === id ? { ...n, data: { ...n.data, node: { ...n.data.node, ...patch } } } : n)));
    setDirty(true);
  };
  const updateEdge = (id: string, patch: { maxLoops?: number; onLimit?: string }) => {
    setEdges(es => es.map(e => {
      if (e.id !== id) return e;
      const data = { ...(e.data as object), ...patch };
      return { ...e, data, label: `${e.sourceHandle}${data.maxLoops ? ` · max ${data.maxLoops}` : ''}` };
    }));
    setDirty(true);
  };
  const remove = () => {
    if (!sel) return;
    if (sel.kind === 'node') {
      setNodes(ns => ns.filter(n => n.id !== sel.id));
      setEdges(es => es.filter(e => e.source !== sel.id && e.target !== sel.id));
    } else setEdges(es => es.filter(e => e.id !== sel.id));
    setSel(null);
    setDirty(true);
  };

  if (!meta || !definition) return <div className="p-6"><QueryState isLoading={wf.isLoading} error={wf.error} /></div>;
  const selNode = sel?.kind === 'node' ? nodes.find(n => n.id === sel.id)?.data.node : undefined;
  const selEdge = sel?.kind === 'edge' ? edges.find(e => e.id === sel.id) : undefined;
  const saveError = save.error as (Error & { message: string }) | null;

  return (
    <div className="flex min-h-screen flex-col gap-3 p-4 xl:h-screen">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <Link to="/workflows" className="text-sm text-muted-foreground hover:underline">Workflows</Link>
          <span className="text-muted-foreground">/</span>
          <Input className="w-80 font-medium" value={meta.name} onChange={e => { setMeta({ ...meta, name: e.target.value }); setDirty(true); }} />
          <code className="text-xs text-muted-foreground">workflows/{meta.id}.workflow.json</code>
        </div>
        <div className="flex items-center gap-2">
          {problems.length > 0 ? <Badge variant="red"><AlertTriangle className="size-3" />{problems.length} problems</Badge> : <Badge variant="green">valid</Badge>}
          {dirty && <Badge variant="amber">unsaved</Badge>}
          <Button size="sm" disabled={!dirty || problems.length > 0 || save.isPending} onClick={() => save.mutate()}><Save className="size-3.5" />Save</Button>
        </div>
      </div>
      {saveError && <p className="text-sm text-red-600">{saveError.message}</p>}

      <div className="grid min-h-0 flex-1 gap-3 xl:grid-cols-[170px_minmax(0,1fr)_340px]">
        <Card className="overflow-y-auto">
          <CardHeader><CardTitle>Add a node</CardTitle></CardHeader>
          <CardContent className="flex flex-wrap gap-1.5 xl:flex-col">
            {(types.data ?? []).filter(t => t.type !== 'trigger.jira').map(t => (
              <button key={t.type} title={t.description} onClick={() => addNode(t.type)}
                className={cn('flex items-center gap-1.5 rounded-md border-l-4 bg-muted/40 px-2 py-1.5 text-left text-xs hover:bg-accent', TYPE_COLOR[t.type])}>
                <Plus className="size-3" />{t.title}
              </button>
            ))}
            <p className="mt-2 text-[11px] text-muted-foreground">Drag from a port (right dot) to a node to connect. Select a node or edge, then Delete or use the panel.</p>
          </CardContent>
        </Card>

        <Card className="h-[560px] overflow-hidden xl:h-auto">
          <ReactFlow
            nodes={nodes} edges={edges} nodeTypes={nodeTypes} colorMode="system" fitView minZoom={0.2} proOptions={{ hideAttribution: true }}
            onNodesChange={ch => { onNodesChange(ch); if (ch.some(c => c.type === 'position' && !c.dragging)) setDirty(true); }}
            onEdgesChange={ch => { onEdgesChange(ch); if (ch.some(c => c.type === 'remove')) setDirty(true); }}
            onConnect={onConnect}
            onNodeClick={(_, n) => setSel({ kind: 'node', id: n.id })}
            onEdgeClick={(_, e) => setSel({ kind: 'edge', id: e.id })}
            onPaneClick={() => setSel(null)}
            onNodesDelete={() => setDirty(true)}
          >
            <Background gap={16} />
            <MiniMap pannable zoomable className="!bg-card" style={{ width: 140, height: 90 }} />
            <Controls />
          </ReactFlow>
        </Card>

        <div className="flex min-h-0 flex-col gap-3 overflow-y-auto">
          {selNode && (
            <NodeForm key={selNode.id} node={selNode} info={info.get(selNode.type)} skills={skills.data ?? []} onChange={p => updateNode(selNode.id, p)} onDelete={selNode.type === 'trigger.jira' ? undefined : remove} />
          )}
          {selEdge && (
            <Card>
              <CardHeader><CardTitle>Edge: {selEdge.source} · {selEdge.sourceHandle} → {selEdge.target}</CardTitle></CardHeader>
              <CardContent className="flex flex-col gap-2 text-sm">
                <label className="flex flex-col gap-1 text-xs">Max times this edge is followed in one run (empty = no limit)
                  <Input type="number" min={1} value={(selEdge.data as { maxLoops?: number })?.maxLoops ?? ''} onChange={e => updateEdge(selEdge.id, { maxLoops: e.target.value ? Number(e.target.value) : undefined })} />
                </label>
                <label className="flex flex-col gap-1 text-xs">When the limit is reached, go to
                  <Select value={(selEdge.data as { onLimit?: string })?.onLimit ?? ''} onChange={e => updateEdge(selEdge.id, { onLimit: e.target.value || undefined })}>
                    <option value="">(fail the run)</option>
                    {nodes.map(n => <option key={n.id} value={n.id}>{n.data.node.label}</option>)}
                  </Select>
                </label>
                <Button size="sm" variant="ghost" onClick={remove}><Trash2 className="size-3.5" />Delete edge</Button>
              </CardContent>
            </Card>
          )}
          {!sel && (
            <Card>
              <CardHeader><CardTitle>Workflow</CardTitle></CardHeader>
              <CardContent className="flex flex-col gap-2 text-sm">
                <label className="flex flex-col gap-1 text-xs">Description
                  <textarea className="min-h-20 rounded-md border bg-background p-2 text-sm" value={meta.description} onChange={e => { setMeta({ ...meta, description: e.target.value }); setDirty(true); }} />
                </label>
                <p className="text-xs text-muted-foreground">{nodes.length} nodes · {edges.length} edges. Running runs keep the version they started with.</p>
              </CardContent>
            </Card>
          )}
          {problems.length > 0 && (
            <Card className="border-red-500/40">
              <CardHeader><CardTitle>Problems</CardTitle></CardHeader>
              <CardContent><ul className="list-disc pl-4 text-xs text-red-700 dark:text-red-400">{problems.map(p => <li key={p}>{p}</li>)}</ul></CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

function defaultsFor(t?: NodeTypeInfo): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, p] of Object.entries(t?.schema.properties ?? {})) {
    if (p.default !== undefined) out[k] = p.default;
    else if (k === 'prompt') out[k] = '{{issue}}\n\n{{feedback}}';
    else if (k === 'output') out[k] = 'notes';
    else if (k === 'commands') out[k] = ['echo ok'];
  }
  return out;
}

const LONG_TEXT = new Set(['prompt', 'instructions']);
const typeOf = (p: JsonProp): string => {
  if (p.enum) return 'enum';
  const t = Array.isArray(p.type) ? p.type.find(x => x !== 'null') : p.type ?? p.anyOf?.find(a => a.type && a.type !== 'null')?.type;
  return String(t ?? 'string');
};

function NodeForm({ node, info, skills, onChange, onDelete }: {
  node: WorkflowNode; info?: NodeTypeInfo; skills: SkillInfo[]; onChange: (p: Partial<WorkflowNode>) => void; onDelete?: () => void;
}) {
  const cfg = node.config as Record<string, unknown>;
  const set = (k: string, v: unknown) => {
    const next = { ...cfg };
    if (v === undefined || v === '') delete next[k];
    else next[k] = v;
    onChange({ config: next });
  };
  const props = Object.entries(info?.schema.properties ?? {});
  return (
    <Card>
      <CardHeader>
        <CardTitle>{info?.title ?? node.type} <code className="text-xs font-normal text-muted-foreground">{node.id}</code></CardTitle>
        <p className="text-xs text-muted-foreground">{info?.description}</p>
      </CardHeader>
      <CardContent className="flex flex-col gap-2.5 text-sm">
        <label className="flex flex-col gap-1 text-xs">Label
          <Input value={node.label} onChange={e => onChange({ label: e.target.value })} />
        </label>
        {props.map(([k, p]) => {
          const kind = typeOf(p);
          const v = cfg[k];
          if (k === 'skill') {
            return (
              <label key={k} className="flex flex-col gap-1 text-xs">Skill
                <Select value={String(v ?? '')} onChange={e => set(k, e.target.value || undefined)}>
                  <option value="">(none)</option>
                  {skills.map(s => <option key={s.path} value={s.path}>{s.name}</option>)}
                </Select>
              </label>
            );
          }
          if (k === 'skills') {
            const list = (v as string[] | undefined) ?? [];
            return (
              <fieldset key={k} className="flex flex-col gap-1 text-xs">
                <legend className="mb-1">Skills</legend>
                {skills.map(s => (
                  <label key={s.path} className="flex items-center gap-1.5">
                    <input type="checkbox" checked={list.includes(s.path)} onChange={e => set(k, e.target.checked ? [...list, s.path] : list.filter(x => x !== s.path))} />{s.name}
                  </label>
                ))}
              </fieldset>
            );
          }
          if (kind === 'enum') {
            return (
              <label key={k} className="flex flex-col gap-1 text-xs">{k}
                <Select value={String(v ?? p.default ?? '')} onChange={e => set(k, e.target.value)}>{p.enum!.map(o => <option key={o}>{o}</option>)}</Select>
              </label>
            );
          }
          if (kind === 'array') {
            return (
              <label key={k} className="flex flex-col gap-1 text-xs">{k} <span className="text-muted-foreground">(one per line)</span>
                <textarea className="min-h-20 rounded-md border bg-background p-2 font-mono text-xs" value={((v as string[] | undefined) ?? []).join('\n')}
                  placeholder={Array.isArray(p.default) && p.default.length ? `default:\n${(p.default as string[]).join('\n')}` : ''}
                  onChange={e => {
                    const lines = e.target.value.split('\n').map(s => s.trim());
                    // keep the typed lines while editing; an empty box means "use the default"
                    set(k, lines.some(Boolean) ? lines.filter((l, i) => l || i === lines.length - 1) : undefined);
                  }} />
              </label>
            );
          }
          if (kind === 'number' || kind === 'integer') {
            return (
              <label key={k} className="flex flex-col gap-1 text-xs">{k}
                <Input type="number" value={v === undefined ? '' : String(v)} placeholder={p.default !== undefined ? String(p.default) : ''} onChange={e => set(k, e.target.value === '' ? undefined : Number(e.target.value))} />
              </label>
            );
          }
          if (LONG_TEXT.has(k)) {
            return (
              <label key={k} className="flex flex-col gap-1 text-xs">{k}
                <textarea className="min-h-40 rounded-md border bg-background p-2 font-mono text-xs" value={String(v ?? '')} onChange={e => set(k, e.target.value)} />
                {k === 'prompt' && <span className="text-[11px] text-muted-foreground">Placeholders: {'{{issue}} {{issue_key}} {{artifact:<name>}} {{feedback}} {{branch}} {{base_ref}} {{diff}} {{repo_path}}'}</span>}
              </label>
            );
          }
          return (
            <label key={k} className="flex flex-col gap-1 text-xs">{k}
              <Input value={String(v ?? '')} placeholder={p.default !== undefined ? String(p.default) : ''} onChange={e => set(k, e.target.value)} />
            </label>
          );
        })}
        {onDelete && <Button size="sm" variant="ghost" onClick={onDelete}><Trash2 className="size-3.5" />Delete node</Button>}
      </CardContent>
    </Card>
  );
}
