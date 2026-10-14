import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from '@tanstack/react-router';
import { Background, BackgroundVariant, Controls, MarkerType, ReactFlow, type Edge, type Node } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { ExternalLink, GitBranch } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { AGENT_EXECUTORS, AI_ENGINES, HUMAN_NODE_TYPES, NODE_PORTS, type NodeType, type ArtifactDto, type NodeRunDto, type RunDiff, type WorkflowNode, type WorkflowRunDetail } from '@ot/contracts';
import { edgeTypes, type InsertEdgeData } from '@/components/flow/insert-edge';
import { metaOf } from '@/components/flow/meta';
import { agentOf, agentTitle, nodeTypes, type CardData, type NodeState } from '@/components/flow/node-card';
import { MarkdownPanel } from '@/components/markdown';
import { QueryState } from '@/components/page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { api } from '@/lib/api';
import { cn, timeAgo } from '@/lib/utils';
import { RUN_STATUS } from './runs';
import { ChangeWorkflow, canChangeWorkflow } from '@/components/workflow-picker';



/** The agent picked for a step in this run only (run vars `engine` / `executor`). */
const agentOverrideOf = (run: WorkflowRunDetail, node: WorkflowNode): string | undefined =>
  (run.vars[node.type === 'agent.run' ? 'executor' : 'engine'] as Record<string, string> | undefined)?.[node.id];

/** The step failed (or left through "failed") and nothing ran after it except gates waiting for you: it can run again. */
const canRerun = (run: WorkflowRunDetail, nodeId: string) => {
  if (run.status !== 'waiting' && run.status !== 'failed') return false;
  const i = run.nodeRuns.findLastIndex(n => n.nodeId === nodeId);
  const last = run.nodeRuns[i];
  if (!last || !(last.status === 'failed' || (last.status === 'done' && last.port === 'failed'))) return false;
  return run.nodeRuns.slice(i + 1).every(n => n.status === 'waiting' && HUMAN_NODE_TYPES.includes(n.nodeType as NodeType));
};

const mmss = (ms: number) => {
  const t = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
};

/** Proof of life on a running step: a pulsing dot, how long the step has run, and whether the API still answers. */
function LiveStatus({ run, fetchedAt, failing }: { run: WorkflowRunDetail; fetchedAt: number; failing: boolean }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const step = [...run.nodeRuns].reverse().find(n => n.status === 'running' || n.status === 'queued');
  const stale = failing || now - fetchedAt > 15_000;
  if (run.status !== 'running' && !failing) return null;
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground" title="This page checks the server every 3 seconds">
      <span className="relative flex size-2">
        {!stale && <span className="absolute inline-flex size-full animate-ping rounded-full bg-green-500 opacity-75" />}
        <span className={cn('relative inline-flex size-2 rounded-full', stale ? 'bg-red-500' : 'bg-green-500')} />
      </span>
      {stale
        ? `No answer from the server for ${mmss(now - fetchedAt)}: the API may be stopped, so this run is not being updated`
        : step?.startedAt ? `${step.status === 'queued' ? 'queued' : 'running'} ${mmss(now - new Date(step.startedAt).getTime())}` : 'working'}
    </span>
  );
}

function useRunAction(runId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ path, body }: { path: string; body?: unknown }) => api(`/api/workflow-runs/${runId}/${path}`, { method: 'POST', body: JSON.stringify(body ?? {}) }),
    onSettled: () => qc.invalidateQueries({ queryKey: ['wf'] }),
  });
}

export function RunDetailPage() {
  const { runId } = useParams({ strict: false }) as { runId: string };
  const q = useQuery({ queryKey: ['wf', 'run', runId], queryFn: () => api<WorkflowRunDetail>(`/api/workflow-runs/${runId}`), refetchInterval: 3000 });
  const [selected, setSelected] = useState<string | null>(null);
  const r = q.data;
  const [followed, setFollowed] = useState<string | null>(null);
  useEffect(() => {
    if (!r) return;
    const current = r.currentNodeId ?? r.nodeRuns.at(-1)?.nodeId ?? null;
    // follow the run while you are looking at its current step; stay put if you picked another node
    if (!selected || (selected === followed && current && current !== followed)) setSelected(current);
    setFollowed(current);
  }, [r, selected, followed]);
  const action = useRunAction(runId);

  const { nodes, edges } = useMemo(() => {
    if (!r) return { nodes: [] as Node<CardData>[], edges: [] as Edge<InsertEdgeData>[] };
    const latest = new Map<string, NodeRunDto>();
    const count = new Map<string, number>();
    for (const n of r.nodeRuns) {
      latest.set(n.nodeId, n);
      count.set(n.nodeId, (count.get(n.nodeId) ?? 0) + 1);
    }
    const takenPorts = new Map<string, string[]>();
    for (const n of r.nodeRuns) if (n.port) takenPorts.set(n.nodeId, [...new Set([...(takenPorts.get(n.nodeId) ?? []), n.port])]);
    const isTaken = (src: string, port: string) => takenPorts.get(src)?.includes(port) ?? false;
    return {
      nodes: r.workflow.nodes.map(
        (n): Node<CardData> => ({
          id: n.id, type: 'card', position: n.position, selected: n.id === selected,
          data: {
            node: n, ports: [...(NODE_PORTS[n.type] ?? [])], runs: count.get(n.id) ?? 0, taken: takenPorts.get(n.id), agentOverride: agentOverrideOf(r, n),
            state: (latest.get(n.id)?.output.skipped ? 'skipped' : latest.get(n.id)?.status ?? 'idle') as NodeState,
          },
        }),
      ),
      edges: r.workflow.edges.map(
        (e): Edge<InsertEdgeData> => ({
          id: e.id, source: e.source, target: e.target, sourceHandle: e.port, type: 'insert', markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 },
          animated: r.currentNodeId === e.target && isTaken(e.source, e.port),
          data: { port: e.port, maxLoops: e.maxLoops, taken: isTaken(e.source, e.port), dim: !isTaken(e.source, e.port) },
        }),
      ),
    };
  }, [r, selected]);

  if (!r) return <div className="p-6"><QueryState isLoading={q.isLoading} error={q.error} /></div>;
  const node = r.workflow.nodes.find(n => n.id === selected) ?? null;
  const active = ['running', 'waiting', 'failed'].includes(r.status);

  return (
    <div className="flex h-[calc(100vh-0px)] flex-col gap-3 p-4 md:p-6">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            {r.task.url ? (
              <a href={r.task.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-lg font-semibold hover:underline">{r.task.key}<ExternalLink className="size-3.5" /></a>
            ) : <span className="text-lg font-semibold">{r.task.key}</span>}
            <Badge variant={RUN_STATUS[r.status]?.variant ?? 'outline'}>{RUN_STATUS[r.status]?.label ?? r.status}</Badge>
            {r.currentNodeLabel && <span className="text-sm text-muted-foreground">at “{r.currentNodeLabel}”</span>}
            <LiveStatus run={r} fetchedAt={q.dataUpdatedAt} failing={q.isRefetchError} />
          </div>
          <div className="truncate text-sm">{r.task.title}</div>
          <div className="mt-1 flex flex-wrap gap-3 text-xs text-muted-foreground">
            {typeof (r.vars.classification as { type?: string } | undefined)?.type === 'string' && (
              <span>type: <b>{(r.vars.classification as { type: string }).type}</b></span>
            )}
            {r.branch && <span className="inline-flex items-center gap-1"><GitBranch className="size-3" />{r.branch}{r.baseRef ? ` from ${r.baseRef}` : ''}</span>}
            {r.worktreePath && <span title={r.worktreePath}>worktree: <code>{r.worktreePath.split('/').slice(-2).join('/')}</code></span>}
            {r.workplace
              ? <span title={`${r.workplace.path}${r.workplace.origin ? `\norigin ${r.workplace.origin}` : ''}`}>workplace: <b>{r.workplace.brand ?? r.task.project}</b> · {r.workplace.repository ?? r.workplace.path.split('/').filter(Boolean).at(-1)}{r.workplace.origin ? <> · <code>{r.workplace.origin.replace(/^.*[:/]([^/:]+\/[^/]+?)(\.git)?$/, '$1')}</code></> : null}</span>
              : r.mappedRepo && <span title={r.mappedRepo}>repo: <b>{r.mappedRepo.split('/').filter(Boolean).at(-1)}</b> ({r.task.project})</span>}
            {!r.mappedRepo && <span className="text-amber-600">project {r.task.project} has no workplace (Repos page)</span>}
            {!canChangeWorkflow(r) && <span>workflow {r.workflowId}@{r.workflowHash.slice(0, 7)}</span>}
            <span>cost ${r.costUsd.toFixed(2)}</span>
          </div>
        </div>
        <div className="flex gap-2">
          {r.status === 'failed' && <Button size="sm" onClick={() => action.mutate({ path: 'retry' })}>Retry step</Button>}
          {active && <Button size="sm" variant="ghost" onClick={() => confirm('Cancel this run? A running agent is stopped.') && action.mutate({ path: 'cancel' })}>Cancel run</Button>}
        </div>
      </div>
      <ChangeWorkflow run={r} />
      {r.error && <p className="rounded-md border border-red-500/30 bg-red-500/10 p-2 text-sm text-red-700 dark:text-red-400">{r.error}</p>}
      {action.error && <p className="text-sm text-red-600">{(action.error as Error).message}</p>}

      <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[minmax(0,3fr)_minmax(340px,2fr)]">
        <Card className="h-[420px] overflow-hidden lg:h-auto">
          <ReactFlow
            nodes={nodes} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes} fitView nodesDraggable={false} nodesConnectable={false} elementsSelectable
            onNodeClick={(_, n) => setSelected(n.id)} proOptions={{ hideAttribution: true }} colorMode="system" minZoom={0.15}
          >
            <Background variant={BackgroundVariant.Dots} gap={18} size={1.2} />
            <Controls showInteractive={false} />
          </ReactFlow>
        </Card>
        <div className="flex min-h-0 flex-col gap-3 overflow-y-auto">
          {node ? <NodePanel run={r} node={node} /> : <p className="text-sm text-muted-foreground">Click a node.</p>}
          <History run={r} />
        </div>
      </div>
    </div>
  );
}

function artifactsOf(run: WorkflowRunDetail, name: string): ArtifactDto[] {
  return run.artifacts.filter(a => a.name === name).sort((a, b) => b.version - a.version);
}

function ArtifactView({ run, name }: { run: WorkflowRunDetail; name: string }) {
  const versions = artifactsOf(run, name);
  const [v, setV] = useState<number | null>(null);
  const a = versions.find(x => x.version === v) ?? versions[0];
  if (!a) return <p className="text-xs text-muted-foreground">No “{name}” yet.</p>;
  return (
    <MarkdownPanel
      title={name}
      text={a.content}
      maxHeight="max-h-[28rem]"
      extra={versions.length > 1 ? (
        <select className="rounded border bg-card px-1 py-1 text-xs" value={a.version} onChange={e => setV(Number(e.target.value))}>
          {versions.map(x => <option key={x.version} value={x.version}>v{x.version} · {x.author} · {timeAgo(x.createdAt)}</option>)}
        </select>
      ) : null}
    />
  );
}

/** What the step's agent is doing right now: tool calls and messages, polled every 2 s while the step runs. */
function LiveLog({ runId, nodeRun }: { runId: string; nodeRun: NodeRunDto }) {
  const [text, setText] = useState('');
  const [exists, setExists] = useState(false);
  const ref = useRef<HTMLPreElement>(null);
  const stick = useRef(true);
  const active = nodeRun.status === 'running' || nodeRun.status === 'queued';
  useEffect(() => {
    let cancelled = false;
    let next = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    setText('');
    setExists(false);
    const tick = async () => {
      try {
        const r = await api<{ text: string; next: number; exists: boolean; live: boolean }>(`/api/workflow-runs/${runId}/node-runs/${nodeRun.id}/log?from=${next}`);
        if (cancelled) return;
        if (r.next < next) setText(''); // the file started over (a retry)
        next = r.next;
        if (r.exists) setExists(true);
        if (r.text) setText(prev => `${prev}${prev && !prev.endsWith('\n') ? '\n' : ''}${r.text}`);
        if (r.live) timer = setTimeout(tick, 2000);
      } catch {
        if (!cancelled && active) timer = setTimeout(tick, 4000);
      }
    };
    tick();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [runId, nodeRun.id, nodeRun.status, active]);
  useEffect(() => {
    const el = ref.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [text]);
  if (!exists) return active ? <p className="text-xs text-muted-foreground">Waiting for the agent’s first output…</p> : null;
  return (
    <details open={active} className="rounded border">
      <summary className="cursor-pointer px-2 py-1 text-xs font-medium">
        {active ? 'Live log' : 'Log'} <span className="font-normal text-muted-foreground">({text ? text.split('\n').length : 0} lines)</span>
      </summary>
      <pre
        ref={ref}
        onScroll={e => { const el = e.currentTarget; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24; }}
        className="max-h-72 overflow-auto whitespace-pre-wrap break-words border-t bg-muted/40 p-2 font-mono text-[11px] leading-relaxed"
      >{text || '…'}</pre>
    </details>
  );
}

function NodePanel({ run, node }: { run: WorkflowRunDetail; node: WorkflowNode }) {
  const runs = run.nodeRuns.filter(n => n.nodeId === node.id);
  const last = runs.at(-1);
  const cfg = node.config as { output?: string; show?: string[]; editable?: string[]; instructions?: string; criteria?: string[]; commands?: string[]; skill?: string; skills?: string[] };
  const waiting = last?.status === 'waiting';
  return (
    <Card className={waiting ? 'border-amber-500/50' : undefined}>
      <CardHeader>
        <CardTitle>{node.label} <span className="text-xs font-normal text-muted-foreground">({metaOf(node.type).title})</span></CardTitle>
        {(cfg.skill || cfg.skills?.length) && <p className="text-xs text-muted-foreground">skills: {[cfg.skill, ...(cfg.skills ?? [])].filter(Boolean).join(', ')}</p>}
        {cfg.commands && <p className="text-xs text-muted-foreground">commands: {cfg.commands.join(' · ')}</p>}
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        {node.type !== 'trigger.jira' && run.status !== 'running' && !waiting && <RunFrom run={run} node={node} />}
        {agentOf(node) && ['running', 'waiting', 'failed', 'cancelled', 'done'].includes(run.status) && last?.status !== 'running' && !(waiting && node.type === 'agent.run') && <AgentPicker run={run} node={node} />}
        {last && ['ai.step', 'ai.review', 'agent.run', 'doc.write', 'jira.comment', 'git.pr'].includes(node.type) && last.status !== 'waiting' && <LiveLog runId={run.id} nodeRun={last} />}
        {waiting && node.type === 'human.gate' && <GatePanel run={run} cfg={cfg} />}
        {waiting && node.type === 'evaluate' && <EvaluatePanel run={run} criteria={cfg.criteria ?? []} />}
        {waiting && (node.type === 'jira.comment' || node.type === 'git.pr') && last && <ConfirmPanel run={run} nodeRun={last} type={node.type} output={cfg.output ?? ''} />}
        {waiting && node.type === 'agent.run' && last?.output.choose === true && <ExecutorPicker run={run} error={last.error} />}
        {waiting && node.type === 'pr.comment' && last && <PrCommentPanel run={run} nodeRun={last} />}
        {!waiting && last?.status === 'done' && node.type === 'pr.comment' && typeof last.output.prUrl === 'string' && last.port === 'posted' && (
          <a className="text-sm text-sky-600 hover:underline" href={last.output.prUrl} target="_blank" rel="noreferrer">Review posted on the PR →</a>
        )}
        {waiting && node.type === 'agent.run' && typeof last?.output.handoff === 'string' && <HandoffPanel run={run} nodeRun={last} />}
        {!waiting && last?.status === 'done' && typeof last.output.prUrl === 'string' && (
          <a className="text-sm text-sky-600 hover:underline" href={last.output.prUrl} target="_blank" rel="noreferrer">Pull request #{String(last.output.prId)}{last.output.existingPr ? ' (already open)' : ''} →</a>
        )}
        {!waiting && last?.status === 'done' && typeof last.output.commentId === 'string' && <p className="text-xs text-muted-foreground">Posted to {String(last.output.issueKey)} (comment {last.output.commentId}).</p>}
        {node.type === 'doc.write' && typeof last?.output.path === 'string' && (
          <p className="text-xs text-muted-foreground">Written to <code>{last.output.path}</code>{last.output.commit ? <> and committed ({String(last.output.commit)})</> : ' (unchanged, no commit)'}.</p>
        )}
        {!waiting && node.type === 'human.gate' && (cfg.show ?? []).map(n => <ArtifactView key={n} run={run} name={n} />)}
        {cfg.output && !(waiting && (node.type === 'jira.comment' || node.type === 'git.pr')) && <ArtifactView run={run} name={cfg.output} />}
        {node.type === 'agent.run' && <DiffToggle runId={run.id} />}
        {node.type === 'evaluate' && run.evaluation && (
          <div className="text-xs">{Object.entries(run.evaluation.scores).map(([k, v]) => <div key={k}>{k}: <b>{v}/5</b></div>)}{run.evaluation.note && <p className="mt-1 text-muted-foreground">“{run.evaluation.note}”</p>}</div>
        )}
        {runs.length > 0 && (
          <div>
            <div className="mb-1 text-xs font-medium">Runs of this node</div>
            <ul className="flex flex-col gap-1 text-xs">
              {runs.map(n => (
                <li key={n.id} className="rounded border px-2 py-1">
                  <div className="flex flex-wrap gap-2">
                    <b>#{n.attempt}</b><span>{n.status}{n.port ? ` → ${n.port}` : ''}</span>
                    {n.costUsd != null && <span>${n.costUsd.toFixed(3)}</span>}
                    {n.numTurns != null && <span>{n.numTurns} turns</span>}
                    {n.startedAt && <span className="text-muted-foreground">{timeAgo(n.startedAt)}</span>}
                    {n.waitingMs != null && <span className="text-muted-foreground">waited {Math.round(n.waitingMs / 60000)} min</span>}
                  </div>
                  {typeof n.input.feedback === 'string' && <div className="text-amber-700 dark:text-amber-400">feedback: {n.input.feedback}</div>}
                  {n.output.skipped === true && <div className="text-muted-foreground">skipped: {String(n.output.reason)}</div>}
                  {n.error && <div className="text-red-600">{n.error}</div>}
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function GatePanel({ run, cfg }: { run: WorkflowRunDetail; cfg: { show?: string[]; editable?: string[]; instructions?: string } }) {
  const action = useRunAction(run.id);
  const editable = cfg.editable ?? [];
  const [edits, setEdits] = useState<Record<string, string>>(() =>
    Object.fromEntries(editable.map(n => [n, artifactsOf(run, n)[0]?.content ?? ''])),
  );
  const [feedback, setFeedback] = useState('');
  const changed = Object.fromEntries(Object.entries(edits).filter(([n, c]) => c !== (artifactsOf(run, n)[0]?.content ?? '')));
  return (
    <div className="flex flex-col gap-3">
      {cfg.instructions && <p className="rounded-md bg-amber-500/10 p-2 text-xs">{cfg.instructions}</p>}
      {(cfg.show ?? []).filter(n => !editable.includes(n)).map(n => <ArtifactView key={n} run={run} name={n} />)}
      {editable.map(n => (
        <MarkdownPanel
          key={n}
          title={<>{n} <span className="font-normal text-muted-foreground">(editable: your version is what the next steps use)</span></>}
          text={edits[n] ?? ''}
          onChange={v => setEdits({ ...edits, [n]: v })}
          maxHeight="max-h-[32rem]"
        />
      ))}
      {(cfg.show ?? []).includes('implementation') && <DiffToggle runId={run.id} />}
      <textarea className="min-h-16 rounded-md border bg-background p-2 text-sm" placeholder="Feedback for the AI (required to send back)" value={feedback} onChange={e => setFeedback(e.target.value)} />
      <div className="flex flex-wrap gap-2">
        <Button disabled={action.isPending} onClick={() => action.mutate({ path: 'gate', body: { action: 'approved', edits: changed, feedback: feedback || undefined } })}>
          {Object.keys(changed).length ? 'Save edits + approve' : 'Approve'}
        </Button>
        <Button variant="outline" disabled={!feedback.trim() || action.isPending} onClick={() => action.mutate({ path: 'gate', body: { action: 'changes', feedback, edits: changed } })}>
          Send back with feedback
        </Button>
        <Button variant="ghost" onClick={() => confirm('Reject and close this run?') && action.mutate({ path: 'gate', body: { action: 'rejected', feedback: feedback || undefined } })}>Reject</Button>
      </div>
      {action.error && <p className="text-sm text-red-600">{(action.error as Error).message}</p>}
    </div>
  );
}

function ConfirmPanel({ run, nodeRun, type, output }: { run: WorkflowRunDetail; nodeRun: NodeRunDto; type: 'jira.comment' | 'git.pr'; output: string }) {
  const qc = useQueryClient();
  const o = nodeRun.output as { title?: string; target?: string; source?: string; commits?: string[]; uncommitted?: string[] };
  const [text, setText] = useState(() => artifactsOf(run, output)[0]?.content ?? '');
  const [title, setTitle] = useState(o.title ?? '');
  const [target, setTarget] = useState(o.target ?? '');
  const [sure, setSure] = useState(false);
  const act = useMutation({
    mutationFn: (body: unknown) => api<Record<string, unknown>>(`/api/workflow-runs/${run.id}/confirm`, { method: 'POST', body: JSON.stringify(body) }),
    onSettled: () => qc.invalidateQueries({ queryKey: ['wf'] }),
  });
  const isPr = type === 'git.pr';
  return (
    <div className="flex flex-col gap-2">
      <p className="rounded-md bg-amber-500/10 p-2 text-xs">
        {isPr
          ? <>After you confirm, branch <code>{o.source}</code> is pushed to the remote and a Bitbucket pull request into <code>{target || o.target}</code> is opened with this title and description. Nothing is merged.</>
          : <>After you confirm, exactly this text is posted as a comment on <b>{run.task.key}</b>. Status, fields and assignee are not changed.</>}
      </p>
      {nodeRun.error && <p className="rounded-md border border-red-500/30 bg-red-500/10 p-2 text-xs text-red-700 dark:text-red-400">{nodeRun.error}</p>}
      {isPr && (
        <>
          <label className="flex flex-col gap-1 text-xs">Title<input className="h-8 rounded-md border bg-background px-2 text-sm" value={title} onChange={e => setTitle(e.target.value)} /></label>
          <label className="flex flex-col gap-1 text-xs">Target branch<input className="h-8 rounded-md border bg-background px-2 text-sm" value={target} onChange={e => setTarget(e.target.value)} /></label>
          <div className="text-xs">
            <div className="font-medium">Commits to push ({o.commits?.length ?? 0})</div>
            <ul className="max-h-32 overflow-auto font-mono text-[11px]">{(o.commits ?? []).map(c => <li key={c}>{c}</li>)}</ul>
            {!!o.uncommitted?.length && <p className="mt-1 text-amber-700 dark:text-amber-400">Not committed, will not be pushed: {o.uncommitted.join(', ')}</p>}
          </div>
          <DiffToggle runId={run.id} />
        </>
      )}
      <label className="flex flex-col gap-1 text-xs">{isPr ? 'Description' : 'Comment'} (edit before confirming)
        <MarkdownPanel title="Text to post" text={text} onChange={setText} maxHeight="max-h-[32rem]" />
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={sure} onChange={e => setSure(e.target.checked)} />
        {isPr ? `Push ${o.source} and open the PR` : `Post this comment to ${run.task.key}`}
      </label>
      <div className="flex flex-wrap gap-2">
        <Button disabled={!sure || !text.trim() || act.isPending} onClick={() => act.mutate({ action: 'confirm', confirm: true, text, ...(isPr ? { title, targetBranch: target || undefined } : {}) })}>
          {act.isPending ? 'Working…' : isPr ? 'Push and open PR' : 'Post comment'}
        </Button>
        <Button variant="ghost" disabled={act.isPending} onClick={() => act.mutate({ action: 'skip' })}>Skip</Button>
      </div>
      {act.error && <p className="text-sm text-red-600">{(act.error as Error).message}</p>}
    </div>
  );
}

/** Post the approved review as a comment on the member's PR, after explicit confirmation. */
function PrCommentPanel({ run, nodeRun }: { run: WorkflowRunDetail; nodeRun: NodeRunDto }) {
  const qc = useQueryClient();
  const o = nodeRun.output as { draft?: string; source?: string; target?: string; prUrl?: string | null };
  const [text, setText] = useState(o.draft ?? '');
  const [sure, setSure] = useState(false);
  const act = useMutation({
    mutationFn: (body: unknown) => api(`/api/workflow-runs/${run.id}/pr-comment`, { method: 'POST', body: JSON.stringify(body) }),
    onSettled: () => qc.invalidateQueries({ queryKey: ['wf'] }),
  });
  return (
    <div className="flex flex-col gap-2">
      <p className="rounded-md bg-amber-500/10 p-2 text-xs">
        After you confirm, this text is posted as a comment on the pull request {o.prUrl ? <a className="underline" href={o.prUrl} target="_blank" rel="noreferrer">{o.prUrl}</a> : <>for branch <code>{o.source}</code></>}
        {' '}(into <code>{o.target}</code>). Nothing else changes on the PR. Needs BITBUCKET_API_TOKEN in .env; otherwise Skip.
      </p>
      {nodeRun.error && <p className="rounded-md border border-red-500/30 bg-red-500/10 p-2 text-xs text-red-700 dark:text-red-400">{nodeRun.error}</p>}
      <MarkdownPanel title="Text to post" text={text} onChange={setText} maxHeight="max-h-[32rem]" />
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={sure} onChange={e => setSure(e.target.checked)} />Post this review on the PR</label>
      <div className="flex gap-2">
        <Button disabled={!sure || !text.trim() || act.isPending} onClick={() => act.mutate({ action: 'confirm', confirm: true, text })}>Post comment</Button>
        <Button variant="ghost" disabled={act.isPending} onClick={() => act.mutate({ action: 'skip' })}>Skip</Button>
      </div>
      {act.error && <p className="text-sm text-red-600">{(act.error as Error).message}</p>}
    </div>
  );
}

interface ExecutorOption { id: string; title: string; description: string; kind: 'cli' | 'editor'; available: boolean }

/** Who does this step: a CLI agent in the background, or you in an editor with its own agent. */
function ExecutorPicker({ run, error }: { run: WorkflowRunDetail; error: string | null }) {
  const qc = useQueryClient();
  const opts = useQuery({ queryKey: ['wf', 'executors'], queryFn: () => api<ExecutorOption[]>('/api/agent-executors') });
  const pick = useMutation({
    mutationFn: (executor: string) => api(`/api/workflow-runs/${run.id}/executor`, { method: 'POST', body: JSON.stringify({ executor }) }),
    onSettled: () => qc.invalidateQueries({ queryKey: ['wf'] }),
  });
  const group = (kind: 'cli' | 'editor') => (opts.data ?? []).filter(o => o.kind === kind);
  return (
    <div className="flex flex-col gap-3">
      <p className="rounded-md bg-amber-500/10 p-2 text-xs">
        Who implements the approved spec? A CLI agent works in the background in the worktree <code>{run.branch}</code>. An editor opens that worktree with the prompt ready, you work with its agent, then click Done here.
      </p>
      {error && <p className="rounded-md border border-red-500/30 bg-red-500/10 p-2 text-xs text-red-700 dark:text-red-400">{error}</p>}
      {(['cli', 'editor'] as const).map(kind => (
        <div key={kind} className="flex flex-col gap-1.5">
          <div className="text-xs font-medium">{kind === 'cli' ? 'Run in the background (CLI)' : 'Work in an editor'}</div>
          {group(kind).map(o => (
            <button
              key={o.id}
              disabled={!o.available || pick.isPending}
              onClick={() => pick.mutate(o.id)}
              className="flex flex-col items-start rounded-md border px-3 py-2 text-left hover:border-primary hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40"
            >
              <span className="text-sm font-medium">{o.title}{!o.available && ' (not installed)'}</span>
              <span className="text-xs text-muted-foreground">{o.description}</span>
            </button>
          ))}
        </div>
      ))}
      {pick.isPending && <p className="text-xs text-muted-foreground">Starting…</p>}
      {pick.error && <p className="text-sm text-red-600">{(pick.error as Error).message}</p>}
      <p className="text-[11px] text-muted-foreground">If the work loops back here (tests or review failed), the same choice is reused.</p>
    </div>
  );
}

/** Pick the run up again at this step; analysis, spec and the worktree are kept, so earlier steps are not paid for again. */
function RunFrom({ run, node }: { run: WorkflowRunDetail; node: WorkflowNode }) {
  const action = useRunAction(run.id);
  const finished = run.status === 'cancelled' || run.status === 'done';
  return (
    <div className="flex flex-col gap-1">
      <div>
        <Button
          size="sm"
          variant="outline"
          disabled={action.isPending}
          onClick={() => confirm(`Run again from “${node.label}”?${finished ? ' The run is reopened.' : ' The step waiting now is dropped.'} Documents made so far are kept.`) && action.mutate({ path: 'run-from', body: { nodeId: node.id } })}
        >
          Run again from here
        </Button>
      </div>
      {action.error && <p className="text-xs text-red-600">{(action.error as Error).message}</p>}
    </div>
  );
}

/** Who does this step in this run only. The workflow keeps its own choice; a failed step can be retried with another agent. */
function AgentPicker({ run, node }: { run: WorkflowRunDetail; node: WorkflowNode }) {
  const qc = useQueryClient();
  const action = useRunAction(run.id);
  const opts = useQuery({ queryKey: ['wf', 'executors'], queryFn: () => api<ExecutorOption[]>('/api/agent-executors') });
  const set = useMutation({
    mutationFn: (agent: string | null) => api(`/api/workflow-runs/${run.id}/agent`, { method: 'POST', body: JSON.stringify({ nodeId: node.id, agent }) }),
    onSettled: () => qc.invalidateQueries({ queryKey: ['wf'] }),
  });
  const isAgent = node.type === 'agent.run';
  const ids: readonly string[] = isAgent ? AGENT_EXECUTORS : AI_ENGINES;
  const available = (id: string) => opts.data?.find(o => o.id === (isAgent ? id : `${id}-cli`))?.available ?? true;
  const fromWorkflow = agentOf(node)!;
  const override = agentOverrideOf(run, node);
  const failedHere = canRerun(run, node.id);
  return (
    <div className="flex flex-col gap-1.5 rounded-md border p-2">
      <label className="flex flex-wrap items-center gap-2 text-xs">
        <span className="font-medium">Agent for this run</span>
        <select
          className="rounded border bg-card px-1 py-1 text-xs"
          value={override ?? ''}
          disabled={set.isPending}
          onChange={e => set.mutate(e.target.value || null)}
        >
          <option value="">Workflow default ({agentTitle(fromWorkflow)})</option>
          {ids.map(id => <option key={id} value={id} disabled={!available(id)}>{agentTitle(id)}{available(id) ? '' : ' (not installed)'}</option>)}
        </select>
        {failedHere && <Button size="sm" disabled={action.isPending} onClick={() => action.mutate({ path: 'rerun', body: { nodeId: node.id } })}>Retry with {agentTitle(override ?? fromWorkflow)}</Button>}
      </label>
      <p className="text-[11px] text-muted-foreground">
        Only this run changes; the workflow keeps {agentTitle(fromWorkflow)}. Used the next time this step starts (also a retry or a loop back).
      </p>
      {set.error && <p className="text-xs text-red-600">{(set.error as Error).message}</p>}
      {action.error && <p className="text-xs text-red-600">{(action.error as Error).message}</p>}
    </div>
  );
}

/** The worktree is open in an editor; you finish there and report back. */
function HandoffPanel({ run, nodeRun }: { run: WorkflowRunDetail; nodeRun: NodeRunDto }) {
  const qc = useQueryClient();
  const o = nodeRun.output as { handoff: string; worktree?: string; prompt?: string };
  const [note, setNote] = useState('');
  const [copied, setCopied] = useState(false);
  const act = useMutation({
    mutationFn: ({ path, body }: { path: string; body?: unknown }) => api(`/api/workflow-runs/${run.id}/handoff/${path}`, { method: 'POST', body: JSON.stringify(body ?? {}) }),
    onSettled: () => qc.invalidateQueries({ queryKey: ['wf'] }),
  });
  const copy = () => navigator.clipboard.writeText(o.prompt ?? '').then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); });
  return (
    <div className="flex flex-col gap-2">
      <p className="rounded-md bg-amber-500/10 p-2 text-xs">
        Opened in <b>{o.handoff.replace('editor:', '')}</b>: <code className="break-all">{o.worktree}</code> (branch <code>{run.branch}</code>).
        Paste the prompt into its agent, work until it is done, commit on this branch if you can, then click <b>Done</b>.
      </p>
      <div className="flex items-center justify-between text-xs">
        <span className="font-medium">Prompt for the agent</span>
        <Button size="sm" variant="outline" onClick={copy}>{copied ? 'Copied' : 'Copy prompt'}</Button>
      </div>
      <pre className="max-h-64 overflow-auto rounded-md bg-muted/50 p-2 text-[11px] whitespace-pre-wrap">{o.prompt}</pre>
      <DiffToggle runId={run.id} />
      <textarea className="min-h-14 rounded-md border bg-background p-2 text-sm" placeholder="Note (optional): what you did, what is left" value={note} onChange={e => setNote(e.target.value)} />
      <div className="flex flex-wrap gap-2">
        <Button disabled={act.isPending} onClick={() => act.mutate({ path: 'finish', body: { outcome: 'done', note: note || undefined } })}>Done, continue</Button>
        <Button variant="outline" disabled={act.isPending} onClick={() => act.mutate({ path: 'reopen' })}>Open again</Button>
        <Button variant="ghost" disabled={act.isPending} onClick={() => act.mutate({ path: 'finish', body: { outcome: 'failed', note: note || undefined } })}>Couldn't finish</Button>
      </div>
      {act.error && <p className="text-sm text-red-600">{(act.error as Error).message}</p>}
    </div>
  );
}

function EvaluatePanel({ run, criteria }: { run: WorkflowRunDetail; criteria: string[] }) {
  const action = useRunAction(run.id);
  const [scores, setScores] = useState<Record<string, number>>({});
  const [note, setNote] = useState('');
  const complete = criteria.every(c => scores[c]);
  return (
    <div className="flex flex-col gap-2">
      {criteria.map(c => (
        <div key={c} className="flex items-center justify-between gap-2 text-sm">
          <span>{c}</span>
          <span className="flex gap-1">
            {[1, 2, 3, 4, 5].map(v => (
              <button key={v} className={cn('size-7 rounded border text-xs', scores[c] === v && 'bg-primary text-primary-foreground')} onClick={() => setScores({ ...scores, [c]: v })}>{v}</button>
            ))}
          </span>
        </div>
      ))}
      <textarea className="min-h-16 rounded-md border bg-background p-2 text-sm" placeholder="Note (what worked, what to improve in the skills/workflow)" value={note} onChange={e => setNote(e.target.value)} />
      <Button disabled={!complete || action.isPending} onClick={() => action.mutate({ path: 'evaluate', body: { scores, note: note || undefined } })}>Save score and finish</Button>
      {action.error && <p className="text-sm text-red-600">{(action.error as Error).message}</p>}
    </div>
  );
}

function DiffToggle({ runId }: { runId: string }) {
  const [open, setOpen] = useState(false);
  const q = useQuery({ queryKey: ['wf', 'diff', runId], queryFn: () => api<RunDiff>(`/api/workflow-runs/${runId}/diff`), enabled: open });
  return (
    <div>
      <Button size="sm" variant="outline" onClick={() => setOpen(o => !o)}>{open ? 'Hide diff' : 'Show diff'}</Button>
      {open && (
        <pre className="mt-2 max-h-96 overflow-auto rounded-md bg-muted/50 p-2 text-[11px] leading-4">
          {q.isLoading ? 'Loading…' : !q.data?.patch ? 'No changes.' : q.data.patch.split('\n').map((l, i) => (
            <div key={i} className={l.startsWith('+') && !l.startsWith('+++') ? 'text-emerald-700 dark:text-emerald-400' : l.startsWith('-') && !l.startsWith('---') ? 'text-red-700 dark:text-red-400' : l.startsWith('@@') ? 'text-sky-600' : ''}>{l || ' '}</div>
          ))}
        </pre>
      )}
    </div>
  );
}

function History({ run }: { run: WorkflowRunDetail }) {
  return (
    <Card>
      <CardHeader><CardTitle>History</CardTitle></CardHeader>
      <CardContent>
        <ul className="flex max-h-64 flex-col gap-0.5 overflow-y-auto text-xs">
          {run.events.map(e => (
            <li key={e.id} className="flex gap-2">
              <span className="w-16 shrink-0 text-muted-foreground">{new Date(e.createdAt).toLocaleTimeString()}</span>
              <span className="shrink-0 font-medium">{e.action}</span>
              <span className="truncate text-muted-foreground" title={JSON.stringify(e.detail)}>
                {Object.entries(e.detail).filter(([, v]) => v != null && v !== '').map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`).join(' · ')}
              </span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
