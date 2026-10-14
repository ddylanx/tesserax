import { closeSync, existsSync, mkdirSync, openSync, readSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { dataDir } from '@tesserax/config';
import type { AppConfig } from '@tesserax/config';
import type { NodeContext } from './types';

/** Directory that holds a node run's files (prompt, stdout, live log). Same one agent steps already use. */
export const nodeRunDir = (config: AppConfig, runId: string, nodeRunId: string) => join(dataDir(config), 'runs', runId, nodeRunId);

/** Event stream of a read-only AI step, written while it runs. Emptied at the start of every attempt. */
export function liveLogFile(ctx: Pick<NodeContext, 'appConfig' | 'run' | 'nodeRun'>): string {
  const file = join(nodeRunDir(ctx.appConfig, ctx.run.id, ctx.nodeRun.id), 'stream.ndjson');
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, '');
  return file;
}

const clip = (s: unknown, n = 220) => {
  const t = (typeof s === 'string' ? s : JSON.stringify(s) ?? '').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
};

/** One-line summary of a tool's arguments: the path / command / pattern, whichever the tool has. */
function summarizeInput(input: unknown): string {
  if (!input || typeof input !== 'object') return clip(input, 140);
  const o = input as Record<string, unknown>;
  const key = ['file_path', 'path', 'AbsolutePath', 'command', 'CommandLine', 'pattern', 'Query', 'query', 'url', 'description'].find(k => typeof o[k] === 'string');
  return clip(key ? o[key] : o, 140);
}

const home = process.env.HOME ?? '';
const tidy = (s: string) => (home ? s.split(home).join('~') : s);

/** Turns one stream-json event (Claude Code or Antigravity CLI) into log lines. Unknown events are skipped. */
function renderEvent(ev: Record<string, unknown>): string[] {
  const out: string[] = [];
  // ---- Antigravity: { event: init | step_update | result }
  if (typeof ev.event === 'string') {
    if (ev.event === 'init') return ['Started'];
    if (ev.event === 'result') {
      const r = (ev.result ?? {}) as { status?: string; response?: string; num_turns?: number; duration_seconds?: number; error?: string };
      return [`${r.status === 'SUCCESS' ? '✓ Finished' : `✗ ${r.status ?? 'Ended'}`}${r.duration_seconds ? ` in ${Math.round(r.duration_seconds)}s` : ''}${r.error ? `: ${clip(r.error)}` : ''}`];
    }
    if (ev.event === 'step_update') {
      const s = (ev.step_update ?? {}) as { state?: string; step_type?: string; tool_name?: string; duration_seconds?: number; tool_info?: { parameters?: unknown; output?: unknown; error?: { message?: string } } };
      if (s.step_type === 'tool' && s.state === 'ACTIVE') return [`→ ${s.tool_name}  ${summarizeInput(s.tool_info?.parameters)}`];
      if (s.step_type === 'tool' && s.state === 'DONE' && s.tool_info?.output != null) return [`  ← ${clip(s.tool_info.output, 160)}`];
      if (s.step_type === 'tool' && s.state === 'ERROR') return [`  ✗ ${s.tool_name}: ${clip(s.tool_info?.error?.message ?? 'failed', 200)}`];
      if (s.step_type === 'agent_response' && s.state === 'DONE') return [`… model turn done${s.duration_seconds ? ` (${Math.round(s.duration_seconds)}s)` : ''}`];
    }
    return out;
  }
  // ---- Claude Code: { type: system | assistant | user | result }
  const type = ev.type;
  if (type === 'system' && ev.subtype === 'init') return [`Started (${String(ev.model ?? 'claude')})`];
  if (type === 'system' && ev.subtype === 'task_summary' && typeof ev.detail === 'string') return [`… ${clip(ev.detail)}`];
  if (type === 'assistant' || type === 'user') {
    const content = ((ev.message as { content?: unknown } | undefined)?.content ?? []) as unknown;
    if (typeof content === 'string') return [clip(content, 600)];
    for (const b of content as Record<string, unknown>[]) {
      if (b.type === 'text' && typeof b.text === 'string' && b.text.trim()) out.push(b.text.trim());
      else if (b.type === 'tool_use') out.push(`→ ${String(b.name)}  ${summarizeInput(b.input)}`);
      else if (b.type === 'tool_result') {
        const c = Array.isArray(b.content) ? (b.content as { text?: string }[]).map(x => x.text ?? '').join(' ') : b.content;
        out.push(`  ${b.is_error ? '✗' : '←'} ${clip(c, 160)}`);
      }
    }
    return out;
  }
  if (type === 'result') {
    const cost = typeof ev.total_cost_usd === 'number' ? `, $${ev.total_cost_usd.toFixed(3)}` : '';
    return [`${ev.is_error ? '✗ Ended with an error' : '✓ Finished'}${typeof ev.num_turns === 'number' ? ` in ${ev.num_turns} turns` : ''}${cost}`];
  }
  return out;
}

/** Renders complete NDJSON lines into readable log text. Lines that are not JSON are kept as they are. */
export function renderLiveLog(raw: string): string {
  const lines: string[] = [];
  for (const l of raw.split('\n')) {
    const t = l.trim();
    if (!t) continue;
    if (!t.startsWith('{')) {
      lines.push(clip(t, 300));
      continue;
    }
    try {
      lines.push(...renderEvent(JSON.parse(t) as Record<string, unknown>));
    } catch {
      /* partial line */
    }
  }
  return tidy(lines.join('\n'));
}

/** Reads the new complete lines of a node run's log from byte offset `from`. `next` is where to continue. */
export function readLiveLog(dir: string, from: number, maxBytes = 512 * 1024): { text: string; next: number; exists: boolean } {
  const file = ['stream.ndjson', 'stdout.json'].map(f => join(dir, f)).find(f => existsSync(f));
  if (!file) return { text: '', next: 0, exists: false };
  const size = statSync(file).size;
  const start = from > size ? 0 : from; // the file was restarted (a retry): read it again from the top
  if (size === start) return { text: '', next: start, exists: true };
  const len = Math.min(size - start, maxBytes);
  const buf = Buffer.alloc(len);
  const fd = openSync(file, 'r');
  try {
    readSync(fd, buf, 0, len, start);
  } finally {
    closeSync(fd);
  }
  const lastNl = buf.lastIndexOf(0x0a);
  if (lastNl < 0) return { text: '', next: start, exists: true };
  const chunk = buf.subarray(0, lastNl + 1);
  return { text: renderLiveLog(chunk.toString('utf8')), next: start + chunk.length, exists: true };
}
