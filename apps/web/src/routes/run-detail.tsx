import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from '@tanstack/react-router';
import { Background, BackgroundVariant, Controls, MarkerType, ReactFlow, type Edge, type Node } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { ExternalLink, GitBranch } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { NODE_PORTS, type ArtifactDto, type NodeRunDto, type RunDiff, type WorkflowNode, type WorkflowRunDetail } from '@ot/contracts';
import { edgeTypes, type InsertEdgeData } from '@/components/flow/insert-edge';
import { metaOf } from '@/components/flow/meta';
import { nodeTypes, type CardData, type NodeState } from '@/components/flow/node-card';
import { QueryState } from '@/components/page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { api } from '@/lib/api';
import { cn, timeAgo } from '@/lib/utils';
import { RUN_STATUS } from './runs';



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
            node: n, ports: [...(NODE_PORTS[n.type] ?? [])], runs: count.get(n.id) ?? 0, taken: takenPorts.get(n.id),
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
          </div>
          <div className="truncate text-sm">{r.task.title}</div>
          <div className="mt-1 flex flex-wrap gap-3 text-xs text-muted-foreground">
            {typeof (r.vars.classification as { type?: string } | undefined)?.type === 'string' && (
              <span>type: <b>{(r.vars.classification as { type: string }).type}</b></span>
            )}
            {r.branch && <span className="inline-flex items-center gap-1"><GitBranch className="size-3" />{r.branch}{r.baseRef ? ` from ${r.baseRef}` : ''}</span>}
            {r.worktreePath && <span title={r.worktreePath}>worktree: <code>{r.worktreePath.split('/').slice(-2).join('/')}</code></span>}
            {!r.mappedRepo && <span className="text-amber-600">project {r.task.project} has no repo in config/repos.json</span>}
            <span>workflow {r.workflowId}@{r.workflowHash.slice(0, 7)}</span>
            <span>cost ${r.costUsd.toFixed(2)}</span>
          </div>
        </div>
        <div className="flex gap-2">
          {r.status === 'failed' && <Button size="sm" onClick={() => action.mutate({ path: 'retry' })}>Retry step</Button>}
          {active && <Button size="sm" variant="ghost" onClick={() => confirm('Cancel this run? A running agent is stopped.') && action.mutate({ path: 'cancel' })}>Cancel run</Button>}
        </div>
      </div>
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
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between text-xs">
        <span className="font-medium">{name}</span>
        <select className="rounded border bg-card px-1 text-xs" value={a.version} onChange={e => setV(Number(e.target.value))}>
          {versions.map(x => <option key={x.version} value={x.version}>v{x.version} · {x.author} · {timeAgo(x.createdAt)}</option>)}
        </select>
      </div>
      <pre className="max-h-80 overflow-auto rounded-md bg-muted/50 p-2 text-xs whitespace-pre-wrap">{a.content}</pre>
    </div>
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
        {waiting && node.type === 'human.gate' && <GatePanel run={run} cfg={cfg} />}
        {waiting && node.type === 'evaluate' && <EvaluatePanel run={run} criteria={cfg.criteria ?? []} />}
        {waiting && (node.type === 'jira.comment' || node.type === 'git.pr') && last && <ConfirmPanel run={run} nodeRun={last} type={node.type} output={cfg.output ?? ''} />}
        {waiting && node.type === 'agent.run' && last?.output.choose === true && <ExecutorPicker run={run} error={last.error} />}
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
        <label key={n} className="flex flex-col gap-1 text-xs">
          <span className="font-medium">{n} (editable; your version is what the next steps use)</span>
          <textarea className="min-h-64 rounded-md border bg-background p-2 font-mono text-xs" value={edits[n] ?? ''} onChange={e => setEdits({ ...edits, [n]: e.target.value })} />
        </label>
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
        <textarea className="min-h-56 rounded-md border bg-background p-2 font-mono text-xs" value={text} onChange={e => setText(e.target.value)} />
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
