import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from '@tanstack/react-router';
import {
  Background, BackgroundVariant, Controls, MarkerType, MiniMap, Panel, ReactFlow, ReactFlowProvider, addEdge, useEdgesState, useNodesState,
  useReactFlow, type Connection, type Edge, type FinalConnectionState, type Node,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { AlertTriangle, LayoutGrid, Redo2, Save, Undo2, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { validateWorkflow, type NodeType, type WorkflowDefinition, type WorkflowNode } from '@ot/contracts';
import { edgeTypes, type InsertEdgeData } from '@/components/flow/insert-edge';
import { tidyLayout } from '@/components/flow/layout';
import { nodeTypes, type CardData } from '@/components/flow/node-card';
import { NodeForm, defaultsFor, type NodeTypeInfo, type SkillInfo } from '@/components/flow/node-form';
import { NodeMenu, NodeTypeList } from '@/components/flow/node-menu';
import { QueryState } from '@/components/page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/input';
import { api } from '@/lib/api';

type FlowNode = Node<CardData>;
type FlowEdge = Edge<InsertEdgeData>;
interface Meta { id: string; name: string; description: string }
interface Snapshot { meta: Meta; nodes: FlowNode[]; edges: FlowEdge[] }
type Menu = { x: number; y: number } & (
  | { mode: 'insert'; edgeId: string }
  | { mode: 'connect'; from: string; port: string; flowX: number; flowY: number }
  | { mode: 'add'; flowX: number; flowY: number }
);

const MARKER = { type: MarkerType.ArrowClosed, width: 16, height: 16 };

export function WorkflowEditorPage() {
  return (
    <ReactFlowProvider>
      <Editor />
    </ReactFlowProvider>
  );
}

function Editor() {
  const { workflowId } = useParams({ strict: false }) as { workflowId: string };
  const qc = useQueryClient();
  const flow = useReactFlow<FlowNode, FlowEdge>();
  const wf = useQuery({ queryKey: ['wf', 'def', workflowId], queryFn: () => api<{ def: WorkflowDefinition; hash: string }>(`/api/workflows/${workflowId}`) });
  const types = useQuery({ queryKey: ['wf', 'node-types'], queryFn: () => api<NodeTypeInfo[]>('/api/node-types') });
  const skills = useQuery({ queryKey: ['skills'], queryFn: () => api<SkillInfo[]>('/api/skills') });
  const info = useMemo(() => new Map((types.data ?? []).map(t => [t.type, t])), [types.data]);
  const portsOf = useCallback((t: string) => info.get(t as NodeType)?.ports ?? [], [info]);

  const [meta, setMeta] = useState<Meta | null>(null);
  const [nodes, setNodes, onNodesChange] = useNodesState<FlowNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<FlowEdge>([]);
  const [sel, setSel] = useState<{ kind: 'node' | 'edge'; id: string } | null>(null);
  const [menu, setMenu] = useState<Menu | null>(null);
  const [dirty, setDirty] = useState(false);
  const [showProblems, setShowProblems] = useState(false);
  const past = useRef<Snapshot[]>([]);
  const future = useRef<Snapshot[]>([]);
  const clipboard = useRef<WorkflowNode[]>([]);
  const [, force] = useState(0);

  // Callbacks referenced from node/edge data; kept in a ref so the data objects stay stable.
  const handlers = useRef({ duplicate: (_id: string) => {}, remove: (_id: string) => {}, insert: (_id: string, _x: number, _y: number) => {} });
  const toFlowNode = useCallback(
    (n: WorkflowNode): FlowNode => ({
      id: n.id, type: 'card', position: n.position,
      data: { node: n, ports: portsOf(n.type), onDuplicate: id => handlers.current.duplicate(id), onDelete: id => handlers.current.remove(id) },
    }),
    [portsOf],
  );
  const toFlowEdge = useCallback(
    (e: { id: string; source: string; target: string; port: string; maxLoops?: number; onLimit?: string }): FlowEdge => ({
      id: e.id, source: e.source, target: e.target, sourceHandle: e.port, type: 'insert', markerEnd: MARKER,
      data: { port: e.port, maxLoops: e.maxLoops, onLimit: e.onLimit, onInsert: (id, x, y) => handlers.current.insert(id, x, y) },
    }),
    [],
  );

  // Load once per workflow, after node types are known (they give each node its ports).
  useEffect(() => {
    if (!wf.data || !types.data || meta?.id === wf.data.def.id) return;
    const d = wf.data.def;
    setMeta({ id: d.id, name: d.name, description: d.description });
    setNodes(d.nodes.map(toFlowNode));
    setEdges(d.edges.map(toFlowEdge));
    past.current = [];
    future.current = [];
    setDirty(false);
  }, [wf.data, types.data, meta?.id, setNodes, setEdges, toFlowNode, toFlowEdge, flow]);

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
        id: e.id, source: e.source, target: e.target, port: e.sourceHandle ?? e.data?.port ?? 'next',
        ...(e.data?.maxLoops ? { maxLoops: e.data.maxLoops } : {}),
        ...(e.data?.onLimit ? { onLimit: e.data.onLimit } : {}),
      })),
    };
  }, [meta, nodes, edges]);
  const problems = useMemo(() => (definition ? validateWorkflow(definition) : []), [definition]);

  // Flag nodes named in problems. Returns the same array when nothing changed, or this effect would loop.
  useEffect(() => {
    setNodes(ns => {
      let changed = false;
      const next = ns.map(n => {
        const invalid = problems.some(p => p.includes(`"${n.data.node.label}"`));
        if (invalid === Boolean(n.data.invalid)) return n;
        changed = true;
        return { ...n, data: { ...n.data, invalid } };
      });
      return changed ? next : ns;
    });
  }, [problems, setNodes]);

  // ---------- history ----------
  const snapshot = useCallback((): Snapshot | null => (meta ? { meta, nodes: flow.getNodes(), edges: flow.getEdges() } : null), [meta, flow]);
  const record = useCallback(() => {
    const s = snapshot();
    if (!s) return;
    past.current = [...past.current.slice(-49), s];
    future.current = [];
    setDirty(true);
    force(x => x + 1);
  }, [snapshot]);
  const restore = (s: Snapshot) => {
    setMeta(s.meta);
    setNodes(s.nodes);
    setEdges(s.edges);
    setDirty(true);
  };
  const undo = () => {
    const prev = past.current.pop();
    const cur = snapshot();
    if (!prev || !cur) return;
    future.current.push(cur);
    restore(prev);
    force(x => x + 1);
  };
  const redo = () => {
    const next = future.current.pop();
    const cur = snapshot();
    if (!next || !cur) return;
    past.current.push(cur);
    restore(next);
    force(x => x + 1);
  };

  // ---------- node operations ----------
  const newId = useCallback((type: string, taken: Set<string>) => {
    const base = type.replace(/[^a-z]/g, '_');
    let i = 1;
    while (taken.has(`${base}_${i}`)) i++;
    return `${base}_${i}`;
  }, []);

  const createNode = useCallback(
    (type: NodeType, position: { x: number; y: number }): FlowNode => {
      const t = info.get(type);
      const id = newId(type, new Set(flow.getNodes().map(n => n.id)));
      return toFlowNode({ id, type, label: t?.title ?? type, position, config: defaultsFor(t) });
    },
    [info, newId, flow, toFlowNode],
  );

  const addNodeAt = (type: NodeType, position: { x: number; y: number }) => {
    record();
    const n = createNode(type, position);
    setNodes(ns => [...ns.map(x => ({ ...x, selected: false })), { ...n, selected: true }]);
    setSel({ kind: 'node', id: n.id });
    return n;
  };

  handlers.current.duplicate = id => {
    const src = flow.getNode(id);
    if (!src || src.data.node.type === 'trigger.jira') return;
    record();
    const copy = createNode(src.data.node.type, { x: src.position.x + 40, y: src.position.y + 60 });
    copy.data = { ...copy.data, node: { ...structuredClone(src.data.node), id: copy.id, label: `${src.data.node.label} (copy)`, position: copy.position } };
    setNodes(ns => [...ns, copy]);
    setSel({ kind: 'node', id: copy.id });
  };
  handlers.current.remove = id => {
    if (flow.getNode(id)?.data.node.type === 'trigger.jira') return;
    record();
    setNodes(ns => ns.filter(n => n.id !== id));
    setEdges(es => es.filter(e => e.source !== id && e.target !== id));
    setSel(null);
  };
  handlers.current.insert = (edgeId, x, y) => setMenu({ mode: 'insert', edgeId, x, y });

  const pickFromMenu = (type: NodeType) => {
    const m = menu;
    setMenu(null);
    if (!m) return;
    if (m.mode === 'add') return void addNodeAt(type, { x: m.flowX, y: m.flowY });
    if (m.mode === 'connect') {
      const n = addNodeAt(type, { x: m.flowX, y: m.flowY - 40 });
      setEdges(es => [...es, toFlowEdge({ id: `e${Date.now().toString(36)}`, source: m.from, port: m.port, target: n.id })]);
      return;
    }
    // insert into a connection: source --port--> new --first port--> old target
    const e = flow.getEdge(m.edgeId);
    const s = e && flow.getNode(e.source);
    const t = e && flow.getNode(e.target);
    if (!e || !s || !t) return;
    const n = addNodeAt(type, { x: (s.position.x + t.position.x) / 2, y: (s.position.y + t.position.y) / 2 + 40 });
    const firstPort = portsOf(type)[0] ?? 'next';
    const stamp = Date.now().toString(36);
    setEdges(es => [
      ...es.filter(x => x.id !== e.id),
      toFlowEdge({ id: `e${stamp}a`, source: e.source, port: e.sourceHandle ?? 'next', target: n.id }),
      toFlowEdge({ id: `e${stamp}b`, source: n.id, port: firstPort, target: e.target }),
    ]);
  };

  // ---------- canvas events ----------
  const onConnect = useCallback(
    (c: Connection) => {
      record();
      setEdges(es => addEdge(toFlowEdge({ id: `e${Date.now().toString(36)}`, source: c.source, target: c.target, port: c.sourceHandle ?? 'next' }), es));
    },
    [record, setEdges, toFlowEdge],
  );

  // Dropping a connection on empty canvas opens the node menu there (n8n style).
  const onConnectEnd = useCallback(
    (event: MouseEvent | TouchEvent, state: FinalConnectionState) => {
      if (state.isValid || !state.fromNode || !state.fromHandle?.id || state.fromHandle.type !== 'source') return;
      const { clientX, clientY } = 'changedTouches' in event ? event.changedTouches[0]! : event;
      const p = flow.screenToFlowPosition({ x: clientX, y: clientY });
      setMenu({ mode: 'connect', from: state.fromNode.id, port: state.fromHandle.id, x: clientX, y: clientY, flowX: p.x, flowY: p.y });
    },
    [flow],
  );

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const type = e.dataTransfer.getData('application/ot-node') as NodeType;
    if (type) addNodeAt(type, flow.screenToFlowPosition({ x: e.clientX - 120, y: e.clientY - 30 }));
  };

  const tidy = async () => {
    record();
    setNodes(await tidyLayout(flow.getNodes(), flow.getEdges()));
    setTimeout(() => flow.fitView({ padding: 0.15, duration: 300 }), 30);
  };

  const save = useMutation({
    mutationFn: () => api<{ hash: string }>(`/api/workflows/${workflowId}`, { method: 'PUT', body: JSON.stringify(definition) }),
    onSuccess: () => {
      setDirty(false);
      qc.invalidateQueries({ queryKey: ['wf', 'list'] });
    },
  });

  // ---------- keyboard ----------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input, textarea, select, [contenteditable]')) return;
      const mod = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();
      if (mod && key === 'z') return void (e.preventDefault(), e.shiftKey ? redo() : undo());
      if (mod && key === 'y') return void (e.preventDefault(), redo());
      if (mod && key === 's') {
        e.preventDefault();
        if (dirty && !problems.length) save.mutate();
        return;
      }
      if (mod && key === 'd' && sel?.kind === 'node') return void (e.preventDefault(), handlers.current.duplicate(sel.id));
      if (mod && key === 'c') {
        clipboard.current = flow.getNodes().filter(n => n.selected && n.data.node.type !== 'trigger.jira').map(n => structuredClone(n.data.node));
        return;
      }
      if (mod && key === 'v' && clipboard.current.length) {
        e.preventDefault();
        record();
        const taken = new Set(flow.getNodes().map(n => n.id));
        const pasted = clipboard.current.map(n => {
          const id = newId(n.type, taken);
          taken.add(id);
          return toFlowNode({ ...n, id, label: `${n.label} (copy)`, position: { x: n.position.x + 60, y: n.position.y + 80 } });
        });
        setNodes(ns => [...ns.map(x => ({ ...x, selected: false })), ...pasted.map(p => ({ ...p, selected: true }))]);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (!meta || !definition) {
    return <div className="p-6"><QueryState isLoading={wf.isLoading || types.isLoading} error={wf.error ?? types.error} /></div>;
  }
  const selNode = sel?.kind === 'node' ? nodes.find(n => n.id === sel.id)?.data.node : undefined;
  const selEdge = sel?.kind === 'edge' ? edges.find(e => e.id === sel.id) : undefined;
  const options = (types.data ?? []).map(t => ({ type: t.type, title: t.title, description: t.description }));

  const updateNode = (id: string, patch: Partial<WorkflowNode>) => {
    record();
    setNodes(ns => ns.map(n => (n.id === id ? { ...n, data: { ...n.data, node: { ...n.data.node, ...patch } } } : n)));
  };
  const updateEdge = (id: string, patch: { maxLoops?: number; onLimit?: string }) => {
    record();
    setEdges(es => es.map(e => (e.id === id ? { ...e, data: { ...e.data!, ...patch } } : e)));
  };

  return (
    <div className="flex h-screen flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b bg-card px-4 py-2">
        <Link to="/workflows" className="text-sm text-muted-foreground hover:underline">Workflows</Link>
        <span className="text-muted-foreground">/</span>
        <Input className="h-8 w-72 font-medium" value={meta.name} onFocus={record} onChange={e => setMeta({ ...meta, name: e.target.value })} />
        <code className="hidden text-xs text-muted-foreground lg:inline">workflows/{meta.id}.workflow.json</code>
        <span className="flex-1" />
        <Button size="sm" variant="ghost" title="Undo (Cmd+Z)" disabled={!past.current.length} onClick={undo}><Undo2 className="size-4" /></Button>
        <Button size="sm" variant="ghost" title="Redo (Shift+Cmd+Z)" disabled={!future.current.length} onClick={redo}><Redo2 className="size-4" /></Button>
        <Button size="sm" variant="outline" title="Arrange the nodes automatically" onClick={tidy}><LayoutGrid className="size-3.5" />Tidy up</Button>
        <button onClick={() => setShowProblems(s => !s)} title="Show problems">
          {problems.length > 0 ? <Badge variant="red"><AlertTriangle className="size-3" />{problems.length} problems</Badge> : <Badge variant="green">valid</Badge>}
        </button>
        {dirty && <Badge variant="amber">unsaved</Badge>}
        <Button size="sm" disabled={!dirty || problems.length > 0 || save.isPending} onClick={() => save.mutate()} title="Save (Cmd+S)"><Save className="size-3.5" />Save</Button>
      </div>
      {save.error && <p className="border-b bg-red-500/10 px-4 py-1 text-sm text-red-600">{(save.error as Error).message}</p>}

      <div className="relative flex min-h-0 flex-1">
        <aside className="hidden w-60 shrink-0 flex-col gap-2 overflow-hidden border-r bg-card p-3 md:flex">
          <div className="text-xs font-semibold">Nodes</div>
          <p className="text-[11px] text-muted-foreground">Drag onto the canvas, or click to add.</p>
          <NodeTypeList
            options={options}
            draggable
            onPick={t => addNodeAt(t, flow.screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 }))}
          />
        </aside>

        <div className="relative min-w-0 flex-1" onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }} onDrop={onDrop}>
          <ReactFlow
            nodes={nodes} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes} colorMode="system" minZoom={0.15} maxZoom={1.5} fitView fitViewOptions={{ padding: 0.15 }}
            proOptions={{ hideAttribution: true }} defaultEdgeOptions={{ type: 'insert', markerEnd: MARKER }}
            deleteKeyCode={['Backspace', 'Delete']} multiSelectionKeyCode={['Shift', 'Meta']} snapToGrid snapGrid={[10, 10]}
            onNodesChange={ch => {
              onNodesChange(ch);
              if (ch.some(c => c.type === 'position' && c.dragging === false)) setDirty(true);
            }}
            onEdgesChange={onEdgesChange}
            onBeforeDelete={async ({ nodes: ns, edges: es }) => {
              if (ns.some(n => n.data.node.type === 'trigger.jira')) return false;
              if (ns.length || es.length) record();
              return true;
            }}
            onNodeDragStart={record}
            onConnect={onConnect}
            onConnectEnd={onConnectEnd}
            onNodeClick={(_, n) => setSel({ kind: 'node', id: n.id })}
            onEdgeClick={(_, e) => setSel({ kind: 'edge', id: e.id })}
            onPaneClick={() => setSel(null)}
            onPaneContextMenu={e => {
              e.preventDefault();
              const p = flow.screenToFlowPosition({ x: e.clientX, y: e.clientY });
              setMenu({ mode: 'add', x: e.clientX, y: e.clientY, flowX: p.x, flowY: p.y });
            }}
          >
            <Background variant={BackgroundVariant.Dots} gap={18} size={1.2} />
            <MiniMap pannable zoomable className="!bg-card" style={{ width: 150, height: 96 }} />
            <Controls showInteractive={false} />
            <Panel position="bottom-center" className="hidden rounded-md border bg-card/90 px-2 py-1 text-[11px] text-muted-foreground shadow-sm lg:block">
              Drag a port to empty space or right-click to add a node · “+” on a connection inserts one · Cmd+Z / Shift+Cmd+Z · Cmd+C / V · Cmd+D · Del · Cmd+S
            </Panel>
            {showProblems && problems.length > 0 && (
              <Panel position="top-left" className="max-w-md rounded-md border border-red-500/40 bg-card p-2 text-xs shadow">
                <ul className="list-disc pl-4 text-red-700 dark:text-red-400">{problems.map(p => <li key={p}>{p}</li>)}</ul>
              </Panel>
            )}
          </ReactFlow>
        </div>

        {(selNode || selEdge) && (
          <aside className="absolute inset-y-0 right-0 z-10 flex w-[380px] max-w-full flex-col overflow-y-auto border-l bg-background shadow-xl">
            <div className="sticky top-0 z-10 flex items-center justify-between border-b bg-background px-3 py-2">
              <span className="text-sm font-semibold">{selNode ? 'Node settings' : 'Connection'}</span>
              <button className="rounded p-1 hover:bg-accent" onClick={() => setSel(null)} title="Close"><X className="size-4" /></button>
            </div>
            <div className="p-3">
              {selNode && (
                <NodeForm
                  key={selNode.id}
                  node={selNode}
                  info={info.get(selNode.type)}
                  skills={skills.data ?? []}
                  onChange={p => updateNode(selNode.id, p)}
                  onDelete={selNode.type === 'trigger.jira' ? undefined : () => handlers.current.remove(selNode.id)}
                />
              )}
              {selEdge && (
                <Card>
                  <CardHeader>
                    <CardTitle>{flow.getNode(selEdge.source)?.data.node.label} · {selEdge.sourceHandle} → {flow.getNode(selEdge.target)?.data.node.label}</CardTitle>
                  </CardHeader>
                  <CardContent className="flex flex-col gap-2 text-sm">
                    <label className="flex flex-col gap-1 text-xs">Max times this connection is followed in one run (empty = no limit)
                      <Input type="number" min={1} value={selEdge.data?.maxLoops ?? ''} onChange={e => updateEdge(selEdge.id, { maxLoops: e.target.value ? Number(e.target.value) : undefined })} />
                    </label>
                    <label className="flex flex-col gap-1 text-xs">When the limit is reached, go to
                      <Select value={selEdge.data?.onLimit ?? ''} onChange={e => updateEdge(selEdge.id, { onLimit: e.target.value || undefined })}>
                        <option value="">(fail the run)</option>
                        {nodes.map(n => <option key={n.id} value={n.id}>{n.data.node.label}</option>)}
                      </Select>
                    </label>
                    <Button size="sm" variant="ghost" onClick={() => { record(); setEdges(es => es.filter(x => x.id !== selEdge.id)); setSel(null); }}>Delete connection</Button>
                  </CardContent>
                </Card>
              )}
            </div>
          </aside>
        )}
      </div>
      {menu && <NodeMenu x={menu.x} y={menu.y} options={options} onPick={pickFromMenu} onClose={() => setMenu(null)} />}
    </div>
  );
}
