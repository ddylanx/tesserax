import type { AgentSessionList, McpList, TaskList, WorkflowRunDto } from '@tesserax/contracts';

export const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const MAX = 3900; // Telegram limit is 4096

function ago(iso: string | null): string {
  if (!iso) return '–';
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.round(s / 60)}m`;
  if (s < 86400) return `${Math.round(s / 3600)}h`;
  return `${Math.round(s / 86400)}d`;
}

function clamp(lines: string[], more: (n: number) => string): string {
  const out: string[] = [];
  let len = 0;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]!;
    if (len + l.length + 1 > MAX) {
      out.push(more(lines.length - i));
      break;
    }
    out.push(l);
    len += l.length + 1;
  }
  return out.join('\n');
}

export function formatTasks(list: TaskList): string {
  if (!list.jiraConfigured && list.tasks.length === 0) return 'Jira is not connected yet (set JIRA_* in .env).';
  if (list.tasks.length === 0) return 'No open tasks. 🎉';
  const icon = { in_progress: '🔵', todo: '⚪', done: '✅' } as const;
  const lines = [`<b>Open tasks (${list.tasks.length})</b>`];
  for (const t of list.tasks) {
    const key = t.url ? `<a href="${esc(t.url)}">${esc(t.key ?? '?')}</a>` : esc(t.key ?? '');
    lines.push(`${icon[t.statusCategory]} ${key} ${esc(t.title)} <i>· ${esc(t.status ?? '')}${t.dueAt ? ` · due ${t.dueAt}` : ''}</i>`);
  }
  return clamp(lines, n => `… and ${n} more`);
}

export function formatAgents(list: AgentSessionList): string {
  if (list.sessions.length === 0) return list.lastEventAt ? 'No active Claude Code sessions.' : 'No hook events yet. Install the hooks (see README).';
  const icon = { running: '🔵', waiting: '🟠', idle: '🟢', ended: '⚫' } as const;
  const label = { running: 'running', waiting: 'needs you', idle: 'idle', ended: 'ended' } as const;
  const lines = [`<b>Claude Code sessions (${list.sessions.length})</b>`];
  for (const s of list.sessions) {
    const where = `${esc(s.project ?? '?')}${s.branch ? ` (${esc(s.branch)})` : ''}`;
    const tokens = s.usage ? ` · out ${Math.round(s.usage.outputTokens / 1000)}k` : '';
    lines.push(`${icon[s.status]} <b>${where}</b> ${label[s.status]}${s.stale ? ' (stale)' : ''} · ${ago(s.lastEventAt)} ago${tokens}`);
    if (s.status === 'waiting' && s.lastMessage) lines.push(`   ↳ ${esc(s.lastMessage)}`);
    else if (s.lastPrompt) lines.push(`   ↳ <i>${esc(s.lastPrompt.slice(0, 100))}</i>`);
  }
  return clamp(lines, n => `… and ${n} more lines`);
}

export function formatMcp(list: McpList): string {
  const on = list.servers.filter(s => s.enabled);
  const byName = new Map<string, string[]>();
  for (const s of on) byName.set(s.name, [...(byName.get(s.name) ?? []), s.client]);
  const lines = [`<b>MCP servers on: ${on.length}/${list.servers.length}</b>`];
  for (const [name, clients] of [...byName].sort((a, b) => a[0].localeCompare(b[0]))) {
    lines.push(`🟢 ${esc(name)} <i>· ${esc([...new Set(clients)].join(', '))}</i>`);
  }
  return clamp(lines, n => `… and ${n} more`);
}


/** Workflow run notification. Read-only: it only links to the run page. */
export function formatWorkflowNotice(run: WorkflowRunDto, event: 'waiting' | 'failed' | 'done', webBaseUrl: string): string {
  const link = `${webBaseUrl.replace(/\/+$/, '')}/runs/${run.id}`;
  const key = esc(run.task.key ?? '?');
  const title = esc(run.task.title.slice(0, 120));
  switch (event) {
    case 'waiting':
      return [`🟠 <b>${key}</b> waiting for you${run.currentNodeLabel ? ` at ${esc(run.currentNodeLabel)}` : ''}`, title, `Open: ${esc(link)}`].join('\n');
    case 'failed':
      return [`🔴 <b>${key}</b> workflow failed`, title, esc((run.error ?? '').slice(0, 300)), `Open: ${esc(link)}`].filter(Boolean).join('\n');
    case 'done':
      return [`✅ <b>${key}</b> workflow done`, title, `Open: ${esc(link)}`].join('\n');
  }
}
