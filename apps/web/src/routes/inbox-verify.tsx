import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Copy, GitBranch, Send, X } from 'lucide-react';
import { useState } from 'react';
import type { PipelineRunDetail, RunDiff } from '@tesserax/contracts';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { api } from '@/lib/api';

function CopyText({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      className="inline-flex items-center gap-1 rounded px-1 text-xs text-muted-foreground hover:bg-accent"
      title="Copy"
      onClick={() => navigator.clipboard.writeText(text).then(() => { setDone(true); setTimeout(() => setDone(false), 1200); })}
    >
      {done ? <Check className="size-3" /> : <Copy className="size-3" />}
    </button>
  );
}

function DiffView({ runId }: { runId: string }) {
  const q = useQuery({ queryKey: ['pipeline', 'diff', runId], queryFn: () => api<RunDiff>(`/api/pipeline/runs/${runId}/diff`) });
  if (q.isLoading) return <p className="text-xs text-muted-foreground">Loading diff…</p>;
  if (q.error) return <p className="text-xs text-red-600">{(q.error as Error).message}</p>;
  if (!q.data?.patch) return <p className="text-xs text-muted-foreground">No changes in the worktree.</p>;
  return (
    <pre className="max-h-[32rem] overflow-auto rounded-md bg-muted/50 p-2 text-[11px] leading-4">
      {q.data.patch.split('\n').map((l, i) => (
        <div
          key={i}
          className={
            l.startsWith('+') && !l.startsWith('+++') ? 'text-emerald-700 dark:text-emerald-400'
              : l.startsWith('-') && !l.startsWith('---') ? 'text-red-700 dark:text-red-400'
              : l.startsWith('@@') ? 'text-sky-700 dark:text-sky-400' : ''
          }
        >
          {l || ' '}
        </div>
      ))}
      {q.data.truncated && <div className="text-amber-600">… diff truncated</div>}
    </pre>
  );
}

/** Text proposed for the Jira comment; the user edits it in the dialog before confirming. */
const defaultComment = (run: PipelineRunDetail) =>
  [
    `Tesserax: playbook "${run.playbookId}" ran on branch ${run.branch} (local, not pushed).`,
    run.state === 'verified_true' ? 'Result verified by the developer.' : run.state === 'verified_false' ? 'Result checked by the developer: not correct yet.' : '',
    run.verifyNote ? `Note: ${run.verifyNote}` : '',
    run.result?.summary ?? '',
  ].filter(Boolean).join('\n\n');

function JiraCommentDialog({ run, onClose }: { run: PipelineRunDetail; onClose: () => void }) {
  const qc = useQueryClient();
  const [text, setText] = useState(() => defaultComment(run));
  const [confirmed, setConfirmed] = useState(false);
  const post = useMutation({
    mutationFn: () => api<{ commentId: string }>(`/api/pipeline/runs/${run.id}/jira-comment`, { method: 'POST', body: JSON.stringify({ text, confirm: true }) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['pipeline'] }); onClose(); },
  });
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true">
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col gap-3 rounded-xl border bg-card p-4 shadow-lg">
        <h3 className="font-semibold">Post a comment to {run.task.key}?</h3>
        <p className="text-xs text-muted-foreground">This writes to Jira as you. Only this comment is posted; status, fields and assignee are not changed. Edit the text first if needed.</p>
        <textarea className="min-h-64 flex-1 rounded-md border bg-background p-2 font-mono text-xs" value={text} onChange={e => setText(e.target.value)} />
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />
          I want to post this comment to {run.task.key}
        </label>
        {post.error && <p className="text-sm text-red-600">{(post.error as Error).message}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button disabled={!confirmed || !text.trim() || post.isPending} onClick={() => post.mutate()}>
            <Send className="size-3.5" />Post comment
          </Button>
        </div>
      </div>
    </div>
  );
}

export function VerifyPanel({ run }: { run: PipelineRunDetail }) {
  const qc = useQueryClient();
  const [note, setNote] = useState('');
  const [showDiff, setShowDiff] = useState(false);
  const [dialog, setDialog] = useState(false);
  const verify = useMutation({
    mutationFn: (outcome: boolean) => api(`/api/pipeline/runs/${run.id}/verify`, { method: 'POST', body: JSON.stringify({ outcome, note: note || undefined }) }),
    onSettled: () => qc.invalidateQueries({ queryKey: ['pipeline'] }),
  });
  const r = run.result;
  const pending = run.state === 'awaiting_verify';

  return (
    <Card className={pending ? 'border-amber-500/40' : undefined}>
      <CardHeader><CardTitle>{pending ? 'Verify the result' : 'Result'}</CardTitle></CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        <div className="flex flex-col gap-1 text-xs">
          <div className="flex items-center gap-1"><GitBranch className="size-3" /><code>{run.branch}</code><CopyText text={run.branch ?? ''} /> <span className="text-muted-foreground">(local only, not pushed)</span></div>
          <div className="flex items-center gap-1">worktree <code className="truncate">{run.worktreePath}</code><CopyText text={`cd ${run.worktreePath}`} /></div>
          {r && (
            <div className="flex flex-wrap gap-1.5">
              <Badge variant="outline">playbook {run.playbookId}</Badge>
              {r.diff && <Badge variant="outline">{r.diff.files} files · +{r.diff.insertions} −{r.diff.deletions}</Badge>}
              {r.commits.length > 0 && <Badge variant="outline">{r.commits.length} commits</Badge>}
              {r.costUsd != null && <Badge variant="outline">${r.costUsd.toFixed(2)} (API-equivalent)</Badge>}
              {r.numTurns != null && <Badge variant="outline">{r.numTurns} turns</Badge>}
              {r.durationMs != null && <Badge variant="outline">{Math.round(r.durationMs / 1000)} s</Badge>}
            </div>
          )}
        </div>

        <pre className="max-h-96 overflow-auto rounded-md bg-muted/50 p-2 text-xs whitespace-pre-wrap">{r?.summary ?? '(the agent returned no summary)'}</pre>

        {r?.commits.length ? (
          <ul className="text-xs">{r.commits.map(c => <li key={c}><code>{c}</code></li>)}</ul>
        ) : null}
        {r?.diff?.stat && <pre className="overflow-auto text-[11px] text-muted-foreground">{r.diff.stat}{r.diff.untracked.length ? `\nnew files: ${r.diff.untracked.join(', ')}` : ''}</pre>}
        <div>
          <Button size="sm" variant="outline" onClick={() => setShowDiff(s => !s)}>{showDiff ? 'Hide diff' : 'Show diff'}</Button>
        </div>
        {showDiff && <DiffView runId={run.id} />}

        {pending ? (
          <div className="flex flex-col gap-2 border-t pt-3">
            <textarea className="min-h-16 rounded-md border bg-background p-2 text-sm" placeholder="Note (optional): what was right or wrong" value={note} onChange={e => setNote(e.target.value)} />
            <div className="flex flex-wrap gap-2">
              <Button disabled={verify.isPending} onClick={() => verify.mutate(true)}><Check className="size-4" />Correct (true)</Button>
              <Button variant="outline" disabled={verify.isPending} onClick={() => verify.mutate(false)}><X className="size-4" />Not correct (false)</Button>
            </div>
            {verify.error && <p className="text-sm text-red-600">{(verify.error as Error).message}</p>}
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2 border-t pt-3 text-sm">
            <Badge variant={run.state === 'verified_true' ? 'green' : 'red'}>{run.state === 'verified_true' ? 'verified: correct' : 'verified: not correct'}</Badge>
            {run.verifyNote && <span className="text-muted-foreground">“{run.verifyNote}”</span>}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          {run.jiraCommentId
            ? <span className="text-xs text-muted-foreground">Posted to Jira (comment {run.jiraCommentId}).</span>
            : run.task.url && <Button size="sm" variant="outline" onClick={() => setDialog(true)}><Send className="size-3.5" />Post result to Jira…</Button>}
        </div>
        {dialog && <JiraCommentDialog run={run} onClose={() => setDialog(false)} />}
      </CardContent>
    </Card>
  );
}
