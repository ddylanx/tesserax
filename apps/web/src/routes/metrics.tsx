import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import type { MetricsReport } from '@ot/contracts';
import { Page, QueryState } from '@/components/page';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select } from '@/components/ui/input';
import { Table, TBody, Td, Th, THead, Tr } from '@/components/ui/table';
import { api } from '@/lib/api';
import { timeAgo } from '@/lib/utils';

const fmt = (x: number | null | undefined, unit = '') => (x == null ? '–' : `${x}${unit}`);
const usd = (x: number | null | undefined) => (x == null ? '–' : `$${x.toFixed(2)}`);
const pct = (a: number, total: number) => (total ? `${Math.round((a / total) * 100)}%` : '–');

/** Stacked bar: accepted / edited / sent back (or pass / fail). */
function Split({ parts }: { parts: { n: number; className: string; label: string }[] }) {
  const total = parts.reduce((a, p) => a + p.n, 0);
  if (!total) return <span className="text-muted-foreground">–</span>;
  return (
    <div className="flex min-w-40 flex-col gap-1">
      <div className="flex h-2 w-full overflow-hidden rounded bg-muted">
        {parts.map(p => <div key={p.label} className={p.className} style={{ width: `${(p.n / total) * 100}%` }} title={`${p.label}: ${p.n}`} />)}
      </div>
      <div className="text-[11px] text-muted-foreground">{parts.map(p => `${p.label} ${p.n}`).join(' · ')}</div>
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card>
      <CardContent className="pt-4">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="text-2xl font-semibold">{value}</div>
        {hint && <div className="text-[11px] text-muted-foreground">{hint}</div>}
      </CardContent>
    </Card>
  );
}

export function MetricsPage() {
  const [days, setDays] = useState(30);
  const q = useQuery({ queryKey: ['metrics', days], queryFn: () => api<MetricsReport>(`/api/metrics?days=${days}`), refetchInterval: 30_000 });
  const m = q.data;
  return (
    <Page
      title="Metrics"
      description="How each workflow version, node and skill version performs, to decide what to tune next."
      actions={
        <Select value={days} onChange={e => setDays(Number(e.target.value))}>
          {[7, 30, 90, 365].map(d => <option key={d} value={d}>Last {d} days</option>)}
        </Select>
      }
    >
      <QueryState isLoading={q.isLoading} error={q.error} empty={m?.window.runs === 0} emptyText="No runs in this period yet." />
      {m && m.window.runs > 0 && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <Stat label="Runs" value={String(m.window.runs)} hint={`${m.overview.done} done · ${m.overview.failed} failed · ${m.overview.cancelled} cancelled · ${m.overview.active} active`} />
            <Stat label="Average score" value={fmt(m.overview.avgScore, '/5')} hint="from your evaluations" />
            <Stat label="Cost per finished run" value={usd(m.overview.avgCostUsd)} hint="API-equivalent" />
            <Stat label="Time per finished run" value={fmt(m.overview.avgMinutes, ' min')} hint="start to finish" />
            <Stat label="Your time at gates" value={fmt(m.overview.avgWaitMinutes, ' min')} hint="waiting for review, per run" />
          </div>

          <Card>
            <CardHeader><CardTitle>Workflow versions</CardTitle></CardHeader>
            <Table>
              <THead><Tr><Th>Version</Th><Th>Runs</Th><Th>Done</Th><Th>Score</Th><Th>Per criterion</Th><Th>Cost</Th><Th>Time</Th></Tr></THead>
              <TBody>
                {m.versions.map(v => (
                  <Tr key={`${v.workflowId}@${v.hash}`}>
                    <Td><code>{v.workflowId}@{v.hash.slice(0, 7)}</code><div className="text-xs text-muted-foreground">since {timeAgo(v.firstRun)}</div></Td>
                    <Td>{v.runs}</Td>
                    <Td>{v.done} <span className="text-xs text-muted-foreground">({pct(v.done, v.runs)})</span></Td>
                    <Td>{fmt(v.avgScore)}</Td>
                    <Td className="text-xs">{Object.entries(v.criteria).map(([k, s]) => <div key={k}>{k}: <b>{s}</b></div>)}</Td>
                    <Td>{usd(v.avgCostUsd)}</Td>
                    <Td>{fmt(v.avgMinutes, ' min')}</Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          </Card>

          <Card>
            <CardHeader><CardTitle>Skills: what happened to their output at the next review</CardTitle></CardHeader>
            <Table>
              <THead><Tr><Th>Skill (version)</Th><Th>Used</Th><Th>Accepted as-is / edited / sent back</Th><Th>Cost per use</Th></Tr></THead>
              <TBody>
                {m.skills.map(s => (
                  <Tr key={`${s.path}@${s.hash}`}>
                    <Td>
                      <div className="font-medium">{s.path.replace(/skills\/|\/SKILL\.md/g, '')}</div>
                      <div className="text-xs text-muted-foreground">
                        <code>{s.hash.split(',').map(h => h.slice(0, 7)).join(',')}</code> {s.current ? <Badge variant="green">current</Badge> : <Badge variant="outline">older</Badge>} · nodes {s.nodeIds.join(', ')}
                      </div>
                    </Td>
                    <Td>{s.uses}</Td>
                    <Td>
                      <Split parts={[
                        { n: s.acceptedAsIs, className: 'bg-emerald-500', label: 'as-is' },
                        { n: s.edited, className: 'bg-amber-500', label: 'edited' },
                        { n: s.sentBack, className: 'bg-red-500', label: 'sent back' },
                      ]} />
                    </Td>
                    <Td>{usd(s.avgCostUsd)}</Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          </Card>

          <Card>
            <CardHeader><CardTitle>Nodes</CardTitle></CardHeader>
            <Table>
              <THead><Tr><Th>Node</Th><Th>Ran</Th><Th>Skipped</Th><Th>Retries</Th><Th>Failed</Th><Th>Outcome</Th><Th>Avg time</Th><Th>Cost</Th></Tr></THead>
              <TBody>
                {m.nodes.map(n => (
                  <Tr key={`${n.workflowId}:${n.nodeId}`}>
                    <Td><div className="font-medium">{n.label}</div><div className="text-xs text-muted-foreground">{n.type} · {n.workflowId}</div></Td>
                    <Td>{n.runs}</Td>
                    <Td>{n.skipped || '–'}</Td>
                    <Td>{n.retries || '–'}</Td>
                    <Td className={n.failed ? 'text-red-600' : ''}>{n.failed || '–'}</Td>
                    <Td>
                      {n.gate && (
                        <Split parts={[
                          { n: n.gate.approved, className: 'bg-emerald-500', label: 'approved' },
                          { n: n.gate.edited, className: 'bg-amber-500', label: 'edited' },
                          { n: n.gate.changes, className: 'bg-red-400', label: 'sent back' },
                          { n: n.gate.rejected, className: 'bg-red-700', label: 'rejected' },
                        ]} />
                      )}
                      {n.review && <Split parts={[{ n: n.review.pass, className: 'bg-emerald-500', label: 'pass' }, { n: n.review.fail, className: 'bg-red-500', label: 'fail' }]} />}
                      {n.gate?.avgWaitMinutes != null && <div className="text-[11px] text-muted-foreground">you took {n.gate.avgWaitMinutes} min on average</div>}
                    </Td>
                    <Td>{fmt(n.avgSeconds, 's')}</Td>
                    <Td>{n.avgCostUsd == null ? '–' : `$${n.avgCostUsd.toFixed(3)}`}</Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          </Card>

          {m.evaluations.length > 0 && (
            <Card>
              <CardHeader><CardTitle>Your notes</CardTitle></CardHeader>
              <CardContent className="flex flex-col gap-2 text-sm">
                {m.evaluations.map(e => (
                  <div key={e.runId} className="rounded-md border p-2">
                    <div className="text-xs text-muted-foreground">{e.taskKey} · workflow {e.workflowHash.slice(0, 7)} · {timeAgo(e.createdAt)} · {Object.entries(e.scores).map(([k, v]) => `${k} ${v}`).join(', ')}</div>
                    {e.note && <div>{e.note}</div>}
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </>
      )}
    </Page>
  );
}
