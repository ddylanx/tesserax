import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { AlertTriangle, CheckCircle2, Clock, Hand, Loader2, Moon, Pause } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { AgentActivity, AgentState, AgentStep, Department, Role, TeamActivity } from '@tesserax/contracts';
import { QueryState } from '@/components/page';
import { Badge } from '@/components/ui/badge';
import { api } from '@/lib/api';
import { cn, timeAgo } from '@/lib/utils';

const STATE: Record<AgentState, { label: string; variant: 'blue' | 'slate' | 'amber' | 'red' | 'outline'; icon: typeof Loader2; ring: string }> = {
  running: { label: 'working', variant: 'blue', icon: Loader2, ring: 'ring-sky-500' },
  queued: { label: 'about to start', variant: 'slate', icon: Clock, ring: 'ring-slate-400' },
  waiting: { label: 'waiting for you', variant: 'amber', icon: Hand, ring: 'ring-amber-500' },
  failed: { label: 'last step failed', variant: 'red', icon: AlertTriangle, ring: 'ring-red-500' },
  idle: { label: 'idle', variant: 'outline', icon: Moon, ring: 'ring-transparent' },
};

const IDLE: Omit<AgentActivity, 'roleKey'> = { state: 'idle', current: [], last: null, stats: { done: 0, failed: 0, costUsd: 0 } };

/** Ticks every second so elapsed times move without refetching. */
function useNow() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  return now;
}

function elapsed(from: string | null, now: number): string {
  if (!from) return '';
  const s = Math.max(0, Math.round((now - new Date(from).getTime()) / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h}h ${m}m` : m ? `${m}m ${s % 60}s` : `${s}s`;
}

const initials = (title: string) => title.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]!.toUpperCase()).join('') || '?';

/** Team page → Live: each role as an agent at a desk, grouped by department, refreshed every 3 seconds. */
export function TeamLive({ departments, roles, scopeParam }: { departments: Department[]; roles: Role[]; scopeParam: string }) {
  const q = useQuery({
    queryKey: ['team', 'activity', scopeParam],
    queryFn: () => api<TeamActivity>(`/api/team/activity${scopeParam ? `?${scopeParam}` : ''}`),
    refetchInterval: 3000,
  });
  const now = useNow();
  if (!q.data) return <QueryState isLoading={q.isLoading} error={q.error} />;
  const act = q.data;
  const byKey = new Map(act.agents.map(a => [a.roleKey, a]));
  const known = new Set(roles.map(r => r.key));
  const strangers = act.agents.filter(a => a.roleKey !== null && !known.has(a.roleKey));
  const noRole = byKey.get(null);
  const all = act.agents;
  const count = (s: AgentState) => all.filter(a => a.state === s).length;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Badge variant="blue"><Loader2 className="size-3 animate-spin" />{count('running')} working</Badge>
        <Badge variant="slate">{count('queued')} about to start</Badge>
        <Badge variant="amber">{count('waiting') + act.waitingForYou.length} waiting for you</Badge>
        <Badge variant="red">{all.reduce((n, a) => n + a.stats.failed, 0)} failed steps</Badge>
        <Badge variant="green">{all.reduce((n, a) => n + a.stats.done, 0)} done steps</Badge>
        <span className="text-muted-foreground">
          last {act.windowHours}h · ${all.reduce((n, a) => n + a.stats.costUsd, 0).toFixed(2)} · updated {new Date(act.generatedAt).toLocaleTimeString()}
        </span>
      </div>

      {act.waitingForYou.length > 0 && (
        <section className="flex flex-col gap-2 rounded-xl border border-amber-500/40 bg-amber-500/5 p-3">
          <h2 className="flex items-center gap-2 font-semibold"><Hand className="size-4 text-amber-600" />Waiting for you</h2>
          <ul className="flex flex-col gap-1 text-sm">
            {act.waitingForYou.map(s => (
              <li key={s.nodeRunId} className="flex flex-wrap items-center gap-2">
                <StepLink step={s} />
                <span className="text-muted-foreground">waiting {elapsed(s.startedAt, now)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {departments.map(d => {
        const own = roles.filter(r => r.departmentId === d.id);
        if (!own.length) return null;
        return (
          <section key={d.id} className="flex flex-col gap-2 rounded-xl border p-3" style={{ borderColor: `${d.color}55`, background: `${d.color}0d` }}>
            <h2 className="flex items-center gap-2 font-semibold">
              <span className="inline-block size-2.5 rounded-full" style={{ backgroundColor: d.color }} />
              {d.name}
              <span className="text-xs font-normal text-muted-foreground">{own.filter(r => (byKey.get(r.key)?.state ?? 'idle') !== 'idle').length}/{own.length} busy</span>
            </h2>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {own.map(r => <AgentDesk key={r.id} title={r.title} roleKey={r.key} color={d.color} enabled={r.enabled} activity={byKey.get(r.key) ?? { roleKey: r.key, ...IDLE }} now={now} />)}
            </div>
          </section>
        );
      })}

      {(strangers.length > 0 || noRole) && (
        <section className="flex flex-col gap-2 rounded-xl border border-dashed p-3">
          <h2 className="font-semibold">Other steps</h2>
          <p className="text-xs text-muted-foreground">AI steps whose node names no role, or a role that is not on the Team page (renamed, deleted, or outside this project).</p>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {strangers.map(a => <AgentDesk key={a.roleKey} title={a.roleKey!} roleKey={a.roleKey} color="#64748b" enabled activity={a} now={now} />)}
            {noRole && <AgentDesk title="No role" roleKey={null} color="#64748b" enabled activity={noRole} now={now} />}
          </div>
        </section>
      )}
    </div>
  );
}

function AgentDesk({ title, roleKey, color, enabled, activity, now }: { title: string; roleKey: string | null; color: string; enabled: boolean; activity: AgentActivity; now: number }) {
  const st = STATE[activity.state];
  const Icon = st.icon;
  const running = activity.current.find(s => s.status === 'running');
  return (
    <div className={cn('flex flex-col gap-2 rounded-lg border bg-card p-3 text-sm shadow-sm', !enabled && 'opacity-60')}>
      <div className="flex items-center gap-3">
        <div className="relative">
          <div
            className={cn('flex size-10 items-center justify-center rounded-full text-sm font-semibold text-white ring-2 ring-offset-2 ring-offset-card', st.ring)}
            style={{ backgroundColor: color }}
          >
            {roleKey ? initials(title) : '·'}
          </div>
          {activity.state === 'running' && <span className="absolute -right-0.5 -top-0.5 size-3 animate-ping rounded-full bg-sky-500" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium">{title}</div>
          {roleKey && <div className="truncate font-mono text-xs text-muted-foreground">{roleKey}</div>}
        </div>
        <Badge variant={st.variant}><Icon className={cn('size-3', activity.state === 'running' && 'animate-spin')} />{st.label}</Badge>
      </div>

      {activity.current.map(s => (
        <div key={s.nodeRunId} className="flex flex-col gap-1 rounded-md bg-muted/50 p-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <StepLink step={s} />
            {s.attempt > 1 && <Badge variant="outline">try {s.attempt}</Badge>}
          </div>
          <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
            <span>{s.status === 'running' ? `running ${elapsed(s.startedAt, now)}` : s.status === 'waiting' ? `waiting for your confirmation ${elapsed(s.startedAt, now)}` : 'in the queue'}</span>
            {s.engine && <span>{s.engine}{s.model ? ` · ${s.model}` : ''}</span>}
            {s.numTurns != null && <span>{s.numTurns} turns</span>}
          </div>
        </div>
      ))}
      {activity.current.length > 1 && <span className="text-xs text-muted-foreground">×{activity.current.length} at once</span>}
      {running && <LogTail step={running} />}

      {activity.last && (
        <div className="flex flex-col gap-0.5 border-t pt-2 text-xs">
          <div className="flex flex-wrap items-center gap-1.5 text-muted-foreground">
            {activity.last.status === 'failed' ? <AlertTriangle className="size-3 text-red-600" /> : <CheckCircle2 className="size-3 text-emerald-600" />}
            <span>Last:</span>
            <StepLink step={activity.last} small />
            <span>{timeAgo(activity.last.endedAt)}</span>
            {activity.last.confidence && <Badge variant="outline">confidence {activity.last.confidence}</Badge>}
          </div>
          {activity.last.error && <p className="line-clamp-2 text-red-700 dark:text-red-400">{activity.last.error}</p>}
          {activity.last.summary && <p className="line-clamp-3 whitespace-pre-line">{activity.last.summary}</p>}
          {activity.last.decisionNeeded && <p className="line-clamp-2 text-amber-700 dark:text-amber-400"><Pause className="mr-1 inline size-3" />Needs a decision: {activity.last.decisionNeeded}</p>}
        </div>
      )}

      <div className="flex gap-3 text-xs text-muted-foreground">
        <span>{activity.stats.done} done</span>
        <span>{activity.stats.failed} failed</span>
        <span>${activity.stats.costUsd.toFixed(2)}</span>
      </div>
    </div>
  );
}

function StepLink({ step, small }: { step: AgentStep; small?: boolean }) {
  return (
    <Link to="/runs/$runId" params={{ runId: step.runId }} className={cn('min-w-0 hover:underline', small ? '' : 'font-medium')} title={step.taskTitle}>
      <span className="font-mono">{step.taskKey ?? step.taskTitle.slice(0, 40)}</span>
      <span className="text-muted-foreground"> · {step.stepLabel}</span>
      {!small && step.taskKey && <span className="ml-1 hidden text-muted-foreground xl:inline">{step.taskTitle.length > 48 ? `${step.taskTitle.slice(0, 48)}…` : step.taskTitle}</span>}
    </Link>
  );
}

/** Last lines of what a running agent step is doing (the same log the run page shows). */
function LogTail({ step }: { step: AgentStep }) {
  const q = useQuery({
    queryKey: ['team', 'log', step.nodeRunId],
    queryFn: () => api<{ text: string; live: boolean }>(`/api/workflow-runs/${step.runId}/node-runs/${step.nodeRunId}/log?from=0`),
    refetchInterval: 4000,
  });
  const lines = (q.data?.text ?? '').split('\n').map(l => l.trimEnd()).filter(Boolean).slice(-3);
  if (!lines.length) return null;
  return (
    <pre className="max-h-20 overflow-hidden rounded-md bg-black/80 p-2 font-mono text-[11px] leading-4 text-emerald-200">
      {lines.map(l => (l.length > 160 ? `${l.slice(0, 160)}…` : l)).join('\n')}
    </pre>
  );
}
