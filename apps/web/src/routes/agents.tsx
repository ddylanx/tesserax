import { useQuery } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, GitBranch } from 'lucide-react';
import { Fragment, useState } from 'react';
import type { AgentEventDto, AgentSessionDto, AgentSessionList } from '@tesserax/contracts';
import { Page, QueryState } from '@/components/page';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Select } from '@/components/ui/input';
import { Table, TBody, Td, Th, THead, Tr } from '@/components/ui/table';
import { api } from '@/lib/api';
import { ProjectDot, useProjectScope } from '@/lib/project-context';
import { fmtNumber, timeAgo } from '@/lib/utils';

const STATUS: Record<string, { label: string; variant: 'green' | 'amber' | 'blue' | 'default' | 'outline' }> = {
  running: { label: 'running', variant: 'blue' },
  waiting: { label: 'needs you', variant: 'amber' },
  idle: { label: 'idle', variant: 'green' },
  ended: { label: 'ended', variant: 'outline' },
};

function StatusBadge({ s }: { s: AgentSessionDto }) {
  const st = STATUS[s.status] ?? { label: s.status, variant: 'default' as const };
  return (
    <span className="flex flex-col items-start gap-1">
      <Badge variant={st.variant}>{st.label}</Badge>
      {s.stale && <Badge variant="outline" title="No hook event for 2h+">stale</Badge>}
    </span>
  );
}

function Events({ id }: { id: string }) {
  const q = useQuery({ queryKey: ['agent-events', id], queryFn: () => api<AgentEventDto[]>(`/api/agents/sessions/${id}/events`), refetchInterval: 5_000 });
  return (
    <div className="max-h-72 overflow-y-auto rounded-md bg-muted/50 p-2 text-xs">
      <QueryState isLoading={q.isLoading} error={q.error} empty={q.data?.length === 0} emptyText="No events." />
      {q.data?.map(e => (
        <div key={e.id} className="flex gap-2 py-0.5">
          <span className="w-16 shrink-0 text-muted-foreground">{new Date(e.receivedAt).toLocaleTimeString()}</span>
          <span className="w-32 shrink-0 font-medium">{e.event}{e.toolName ? ` · ${e.toolName}` : ''}</span>
          <span className="truncate text-muted-foreground">{Object.values(e.detail).filter(Boolean).join(' · ')}</span>
        </div>
      ))}
    </div>
  );
}

function Usage({ s }: { s: AgentSessionDto }) {
  if (!s.usage) return <span className="text-muted-foreground">–</span>;
  const u = s.usage;
  return (
    <div className="text-xs leading-5" title={`input ${u.inputTokens}, output ${u.outputTokens}, cache read ${u.cacheReadTokens}, cache write ${u.cacheCreationTokens}`}>
      <div>out <b>{fmtNumber(u.outputTokens)}</b> · in {fmtNumber(u.inputTokens)}</div>
      <div className="text-muted-foreground">cache {fmtNumber(u.cacheReadTokens)} r / {fmtNumber(u.cacheCreationTokens)} w</div>
      {u.contextTokens != null && <div className="text-muted-foreground">context {fmtNumber(u.contextTokens)}</div>}
    </div>
  );
}

export function AgentsPage() {
  const [scope, setScope] = useState<'active' | 'all'>('active');
  const [open, setOpen] = useState<string | null>(null);
  const { scopeParam, selected: scopeSelected } = useProjectScope();
  const q = useQuery({ queryKey: ['agents', scope, scopeParam], queryFn: () => api<AgentSessionList>(`/api/agents/sessions?scope=${scope}&${scopeParam}`), refetchInterval: 3_000 });
  const sessions = q.data?.sessions ?? [];
  const c = q.data?.counts ?? {};

  return (
    <Page
      title="Agents"
      description={<>Claude Code sessions reported by hooks. Last event {timeAgo(q.data?.lastEventAt)}.</>}
      actions={
        <Select value={scope} onChange={e => setScope(e.target.value as 'active' | 'all')}>
          <option value="active">Not ended</option>
          <option value="all">All sessions</option>
        </Select>
      }
    >
      <div className="flex flex-wrap gap-2">
        <Badge variant="blue">running {c.running ?? 0}</Badge>
        <Badge variant="amber">needs you {c.waiting ?? 0}</Badge>
        <Badge variant="green">idle {c.idle ?? 0}</Badge>
        <Badge variant="outline">ended {c.ended ?? 0}</Badge>
      </div>
      {!q.isLoading && !q.data?.lastEventAt && (
        <Card>
          <CardContent className="pt-4 text-sm">
            No hook events received yet. Add the hooks to Claude Code: run <code>pnpm hooks:print</code> to see them,
            then <code>pnpm hooks:install --file &lt;project&gt;/.claude/settings.local.json</code> (one project) or <code>pnpm hooks:install --user</code> (all projects). See the README.
          </CardContent>
        </Card>
      )}
      <Card>
        <QueryState isLoading={q.isLoading} error={q.error} empty={!q.isLoading && sessions.length === 0} emptyText="No sessions." />
        {sessions.length > 0 && (
          <Table>
            <THead><Tr><Th></Th><Th>Status</Th><Th>Project / branch</Th><Th>Last activity</Th><Th>Tokens</Th><Th>Started</Th></Tr></THead>
            <TBody>
              {sessions.map(s => (
                <Fragment key={s.id}>
                  <Tr className="cursor-pointer" onClick={() => setOpen(open === s.id ? null : s.id)}>
                    <Td className="w-6 pr-0">{open === s.id ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}</Td>
                    <Td><StatusBadge s={s} /></Td>
                    <Td>
                      <div className="flex items-center gap-1.5 font-medium">{!scopeSelected && s.projectSlug && <ProjectDot color={s.projectColor} name={s.projectSlug} />}{s.project ?? '–'}</div>
                      {s.branch && <div className="flex items-center gap-1 text-xs"><GitBranch className="size-3" />{s.branch}</div>}
                      <div className="max-w-xs truncate text-xs text-muted-foreground" title={s.cwd ?? ''}>{s.cwd}</div>
                    </Td>
                    <Td className="max-w-sm">
                      <div className="text-xs">
                        <b>{s.lastEvent}</b>{s.lastTool && s.status === 'running' ? ` · ${s.lastTool}` : ''} · {timeAgo(s.lastEventAt)}
                      </div>
                      {s.lastMessage && <div className="text-xs text-amber-700 dark:text-amber-400">{s.lastMessage}</div>}
                      {s.lastPrompt && <div className="truncate text-xs text-muted-foreground" title={s.lastPrompt}>“{s.lastPrompt}”</div>}
                      <div className="text-xs text-muted-foreground">{s.promptCount} prompts · {s.toolCount} tool calls{s.model ? ` · ${s.model}` : ''}</div>
                    </Td>
                    <Td><Usage s={s} /></Td>
                    <Td className="text-xs whitespace-nowrap text-muted-foreground">{timeAgo(s.startedAt)}{s.endedAt && <div>ended {timeAgo(s.endedAt)}</div>}</Td>
                  </Tr>
                  {open === s.id && (
                    <tr><td colSpan={6} className="px-3 pb-3"><Events id={s.id} /></td></tr>
                  )}
                </Fragment>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
    </Page>
  );
}
