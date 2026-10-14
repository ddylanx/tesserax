import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { ExternalLink, GitBranch, Paperclip, Play } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import {
  AUTOMATION_LEVELS, ISSUE_TYPES,
  type DecisionInput, type PipelineList, type PipelineRunDetail, type PipelineRunDto, type PlaybookDto,
} from '@tesserax/contracts';
import { Page, QueryState } from '@/components/page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/input';
import { api } from '@/lib/api';
import { cn, timeAgo } from '@/lib/utils';
import { VerifyPanel } from './inbox-verify';
import { StartWorkflowDialog } from '@/components/workflow-picker';

const GROUPS = [
  { id: 'decide', label: 'Needs decision' },
  { id: 'verify', label: 'Needs verify' },
  { id: 'running', label: 'Running' },
  { id: 'failed', label: 'Failed' },
  { id: 'done', label: 'Done' },
  { id: 'all', label: 'All' },
] as const;

const GROUP_STATES: Record<string, string[]> = {
  decide: ['awaiting_decision'],
  verify: ['awaiting_verify'],
  running: ['new', 'classifying', 'queued', 'running_playbook'],
  failed: ['failed'],
  done: ['rejected', 'verified_true', 'verified_false', 'cancelled'],
};

const STATE: Record<string, { label: string; variant: 'green' | 'amber' | 'blue' | 'red' | 'default' | 'outline' }> = {
  new: { label: 'new', variant: 'outline' },
  classifying: { label: 'classifying…', variant: 'blue' },
  awaiting_decision: { label: 'needs decision', variant: 'amber' },
  rejected: { label: 'rejected', variant: 'outline' },
  queued: { label: 'queued', variant: 'blue' },
  running_playbook: { label: 'running', variant: 'blue' },
  awaiting_verify: { label: 'needs verify', variant: 'amber' },
  verified_true: { label: 'verified ✓', variant: 'green' },
  verified_false: { label: 'verified ✗', variant: 'red' },
  failed: { label: 'failed', variant: 'red' },
  cancelled: { label: 'cancelled', variant: 'outline' },
};

export const StateBadge = ({ state }: { state: string }) => {
  const s = STATE[state] ?? { label: state, variant: 'default' as const };
  return <Badge variant={s.variant}>{s.label}</Badge>;
};

export function usePipelineAction(runId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ action, body }: { action: string; body?: unknown }) =>
      api<unknown>(`/api/pipeline/runs/${runId}/${action}`, { method: 'POST', body: JSON.stringify(body ?? {}) }),
    onSettled: () => qc.invalidateQueries({ queryKey: ['pipeline'] }),
  });
}

export function InboxPage() {
  const search = useSearch({ strict: false }) as { run?: string; group?: string };
  const navigate = useNavigate();
  const group = search.group ?? 'decide';
  const list = useQuery({
    queryKey: ['pipeline', 'list', group],
    queryFn: () => api<PipelineList>(`/api/pipeline/runs${group === 'all' ? '' : `?group=${group}`}`),
    refetchInterval: 4_000,
  });
  const counts = list.data?.counts ?? {};
  const count = (g: string) => (g === 'all' ? Object.values(counts).reduce((a, b) => a + b, 0) : (GROUP_STATES[g] ?? []).reduce((a, s) => a + (counts[s] ?? 0), 0));
  const select = (patch: { run?: string; group?: string }) => navigate({ to: '/inbox', search: { ...search, ...patch } as never });
  const runs = list.data?.runs ?? [];

  return (
    <Page title="Inbox" description="Issue → AI classifies → you decide → AI runs a playbook → you verify.">
      <div className="flex flex-wrap gap-1">
        {GROUPS.map(g => (
          <Button key={g.id} size="sm" variant={group === g.id ? 'default' : 'outline'} onClick={() => select({ group: g.id, run: undefined })}>
            {g.label} <span className="opacity-60">{count(g.id)}</span>
          </Button>
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <Card className="self-start">
          <QueryState isLoading={list.isLoading} error={list.error} empty={!list.isLoading && runs.length === 0}
            emptyText="Nothing here. New Jira issues start a run automatically; or use “Run pipeline” on the Tasks page." />
          <ul className="divide-y">
            {runs.map(r => (
              <li key={r.id}>
                <button
                  className={cn('flex w-full flex-col gap-1 px-3 py-2 text-left text-sm hover:bg-accent/60', search.run === r.id && 'bg-accent')}
                  onClick={() => select({ run: r.id })}
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="font-medium">{r.task.key}</span>
                    <StateBadge state={r.state} />
                  </span>
                  <span className="line-clamp-2">{r.task.title}</span>
                  <span className="text-xs text-muted-foreground">
                    {r.classification ? `${r.classification.type} · ${r.classification.automation} · ${r.playbookId ?? r.classification.playbook ?? 'no playbook'}` : r.trigger}
                    {' · '}{timeAgo(r.stateChangedAt)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </Card>
        {search.run ? <RunDetail id={search.run} /> : <p className="p-4 text-sm text-muted-foreground">Pick a run to see the issue and its actions.</p>}
      </div>
    </Page>
  );
}

function Section({ title, children, className }: { title: string; children: ReactNode; className?: string }) {
  return (
    <Card className={className}>
      <CardHeader><CardTitle>{title}</CardTitle></CardHeader>
      <CardContent className="text-sm">{children}</CardContent>
    </Card>
  );
}

function RunDetail({ id }: { id: string }) {
  const q = useQuery({ queryKey: ['pipeline', 'run', id], queryFn: () => api<PipelineRunDetail>(`/api/pipeline/runs/${id}`), refetchInterval: 3_000 });
  const action = usePipelineAction(id);
  const [starting, setStarting] = useState(false);
  const r = q.data;
  if (!r) return <QueryState isLoading={q.isLoading} error={q.error} />;
  const t = r.task;
  const canCancel = !['rejected', 'verified_true', 'verified_false', 'cancelled'].includes(r.state);

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <Card>
        <CardContent className="flex flex-col gap-2 pt-4">
          <div className="flex flex-wrap items-center gap-2">
            <StateBadge state={r.state} />
            {t.url ? (
              <a href={t.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-semibold hover:underline">
                {t.key}<ExternalLink className="size-3" />
              </a>
            ) : <span className="font-semibold">{t.key}</span>}
            <span className="text-xs text-muted-foreground">{[t.type, t.status, t.priority, t.project].filter(Boolean).join(' · ')}</span>
          </div>
          <h2 className="text-base font-semibold">{t.title}</h2>
          {r.error && <p className="rounded-md border border-red-500/30 bg-red-500/10 p-2 text-sm text-red-700 dark:text-red-400">Failed at {r.errorStep}: {r.error}</p>}
          <div className="flex flex-wrap gap-2">
            {r.state === 'failed' && <Button size="sm" onClick={() => action.mutate({ action: 'retry' })}>Retry</Button>}
            {r.state === 'awaiting_verify' && <Button size="sm" variant="outline" onClick={() => action.mutate({ action: 'rerun' })}>Run playbook again</Button>}
            <Button size="sm" variant="outline" onClick={() => setStarting(true)}><Play className="size-3" />Start workflow…</Button>
            {canCancel && (
              <Button size="sm" variant="ghost" onClick={() => confirm('Cancel this run?') && action.mutate({ action: 'cancel' })}>Cancel run</Button>
            )}
          </div>
          {action.error && <p className="text-sm text-red-600">{(action.error as Error).message}</p>}
        </CardContent>
      </Card>

      {starting && <StartWorkflowDialog task={t} onClose={() => setStarting(false)} />}
      {r.state === 'awaiting_decision' && r.classification && <DecisionPanel run={r} />}
      {['queued', 'running_playbook'].includes(r.state) && <RunningPanel run={r} />}
      {['awaiting_verify', 'verified_true', 'verified_false'].includes(r.state) && <VerifyPanel run={r} />}

      {r.classification && (
        <Section title={`Classification (${r.classificationEngine})`}>
          <div className="flex flex-wrap gap-2">
            <Badge>{r.classification.type}</Badge>
            <Badge>{r.classification.automation}</Badge>
            <Badge variant="outline">playbook: {r.classification.playbook ?? 'none'}</Badge>
            <Badge variant="outline">confidence {Math.round(r.classification.confidence * 100)}%</Badge>
          </div>
          <p className="mt-2 text-muted-foreground">{r.classification.reasoning}</p>
        </Section>
      )}

      <Section title="Issue">
        <pre className="max-h-80 overflow-auto rounded-md bg-muted/50 p-2 text-xs whitespace-pre-wrap">{t.description ?? '(no description)'}</pre>
        {(t.labels.length > 0 || t.components.length > 0) && (
          <p className="mt-2 text-xs text-muted-foreground">labels: {t.labels.join(', ') || '–'} · components: {t.components.join(', ') || '–'}</p>
        )}
        {t.attachments.length > 0 && (
          <ul className="mt-2 flex flex-col gap-0.5 text-xs">
            {t.attachments.map(a => (
              <li key={a.filename + a.created} className="flex items-center gap-1"><Paperclip className="size-3" />{a.filename} <span className="text-muted-foreground">({a.mimeType}, {a.size} B)</span></li>
            ))}
          </ul>
        )}
        {t.comments.length > 0 && (
          <div className="mt-3 flex flex-col gap-2">
            {t.comments.map((c, i) => (
              <div key={i} className="rounded-md border p-2 text-xs">
                <div className="mb-1 text-muted-foreground">{c.author} · {timeAgo(c.created)}</div>
                <div className="whitespace-pre-wrap">{c.body}</div>
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section title="History">
        <ul className="flex flex-col gap-1 text-xs">
          {r.events.map(e => (
            <li key={e.id} className="flex gap-2">
              <span className="w-20 shrink-0 text-muted-foreground">{new Date(e.createdAt).toLocaleTimeString()}</span>
              <span className="shrink-0 font-medium">{e.action}</span>
              {e.toState && <span className="text-muted-foreground">{e.fromState} → {e.toState}</span>}
              <span className="truncate text-muted-foreground" title={JSON.stringify(e.detail)}>{summarize(e.detail)}</span>
            </li>
          ))}
        </ul>
      </Section>
    </div>
  );
}

const summarize = (d: Record<string, unknown>) =>
  Object.entries(d).filter(([, v]) => v != null && v !== '').map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`).join(' · ');

function DecisionPanel({ run }: { run: PipelineRunDetail }) {
  const c = run.classification!;
  const playbooks = useQuery({ queryKey: ['pipeline', 'playbooks'], queryFn: () => api<PlaybookDto[]>('/api/pipeline/playbooks') });
  const action = usePipelineAction(run.id);
  const [d, setD] = useState<DecisionInput>({ type: c.type, automation: c.automation, playbookId: c.playbook ?? '', repoPath: undefined, note: '' });
  useEffect(() => setD({ type: c.type, automation: c.automation, playbookId: c.playbook ?? '', note: '' }), [run.id, c.type, c.automation, c.playbook]);
  const [repo, setRepo] = useState('');
  const needsRepo = !run.mappedRepo;
  const pb = playbooks.data?.find(p => p.id === d.playbookId);

  return (
    <Section title="Your decision" className="border-amber-500/40">
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-xs">Type
          <Select value={d.type} onChange={e => setD({ ...d, type: e.target.value as DecisionInput['type'] })}>
            {ISSUE_TYPES.map(x => <option key={x}>{x}</option>)}
          </Select>
        </label>
        <label className="flex flex-col gap-1 text-xs">Automation
          <Select value={d.automation} onChange={e => setD({ ...d, automation: e.target.value as DecisionInput['automation'] })}>
            {AUTOMATION_LEVELS.map(x => <option key={x}>{x}</option>)}
          </Select>
        </label>
        <label className="flex flex-col gap-1 text-xs sm:col-span-2">Playbook
          <Select value={d.playbookId} onChange={e => setD({ ...d, playbookId: e.target.value })}>
            <option value="">Choose…</option>
            {playbooks.data?.map(p => <option key={p.id} value={p.id}>{p.name} ({p.appliesTo.join(', ')}){p.makesChanges ? ' · edits code' : ' · read-only'}</option>)}
          </Select>
        </label>
        {pb && (
          <ol className="list-decimal pl-5 text-xs text-muted-foreground sm:col-span-2">
            {pb.steps.map(s => <li key={s}>{s}</li>)}
          </ol>
        )}
        <label className="flex flex-col gap-1 text-xs sm:col-span-2">
          Repo {run.mappedRepo ? <span className="text-muted-foreground">(mapped for {run.task.project}: {run.mappedRepo})</span> : null}
          {needsRepo ? (
            <>
              <span className="text-amber-700 dark:text-amber-400">No local repo is mapped for project {run.task.project ?? '(none)'}. Enter its path; it is saved to config/repos.json.</span>
              <Input placeholder="/Users/you/code/repo" value={repo} onChange={e => setRepo(e.target.value)} />
            </>
          ) : null}
        </label>
        <label className="flex flex-col gap-1 text-xs sm:col-span-2">Note for the agent (optional)
          <Input value={d.note ?? ''} onChange={e => setD({ ...d, note: e.target.value })} />
        </label>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        Accepting creates a git worktree on a new branch <code>tx/{run.task.key}</code>{run.baseRef ? <> from <code>{run.baseRef}</code></> : null} (your
        own checkouts are not touched) and runs Claude Code there headless. Nothing is pushed or merged.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button disabled={!d.playbookId || (needsRepo && !repo) || action.isPending}
          onClick={() => action.mutate({ action: 'decide', body: { ...d, note: d.note || undefined, repoPath: needsRepo ? repo : undefined } })}>
          Accept and run
        </Button>
        <Button variant="outline" onClick={() => action.mutate({ action: 'reclassify' })}>Classify again</Button>
        <Button variant="ghost" onClick={() => { const note = prompt('Reject: optional note'); if (note !== null) action.mutate({ action: 'reject', body: { note } }); }}>Reject</Button>
      </div>
      {action.error && <p className="mt-2 text-sm text-red-600">{(action.error as Error).message}</p>}
    </Section>
  );
}

function RunningPanel({ run }: { run: PipelineRunDetail }) {
  return (
    <Section title="Running">
      <div className="flex flex-col gap-1 text-xs">
        <div>Playbook <b>{run.playbookId}</b> in <code>{run.worktreePath ?? run.repoPath}</code></div>
        {run.branch && <div className="flex items-center gap-1"><GitBranch className="size-3" />{run.branch}</div>}
        {run.agentSession
          ? <div>Agent session: {run.agentSession.status} · {run.agentSession.lastEvent}{run.agentSession.lastTool ? ` (${run.agentSession.lastTool})` : ''} · {timeAgo(run.agentSession.lastEventAt)}</div>
          : <div className="text-muted-foreground">Live progress shows here when Claude Code hooks are installed (Agents page). Otherwise the result appears when the run ends.</div>}
      </div>
    </Section>
  );
}

export type { PipelineRunDto };
