import type { ClaudeHookPayload } from '@ot/contracts';
import type { AgentSessionStatus } from '@ot/db';

const clip = (s: unknown, n: number) => (typeof s === 'string' ? (s.length > n ? `${s.slice(0, n)}…` : s) : undefined);

/** New session status for a hook event, or undefined to keep the current one. */
export function statusFor(p: ClaudeHookPayload): AgentSessionStatus | undefined {
  switch (p.hook_event_name) {
    case 'SessionStart':
    case 'Stop':
      return 'idle';
    case 'UserPromptSubmit':
    case 'PreToolUse':
    case 'PostToolUse':
      return 'running';
    case 'Notification':
      // "Claude needs your permission to use Bash" vs "Claude is waiting for your input"
      return /waiting for your input/i.test(p.message ?? '') ? 'idle' : 'waiting';
    case 'SessionEnd':
      return 'ended';
    default:
      return undefined; // SubagentStop, PreCompact, ...
  }
}

/** Small, safe summary of a hook event: no file contents or tool output. */
export function detailFor(p: ClaudeHookPayload): Record<string, unknown> {
  const input = (p.tool_input ?? {}) as Record<string, unknown>;
  switch (p.hook_event_name) {
    case 'UserPromptSubmit':
      return { prompt: clip(p.prompt, 200) };
    case 'PreToolUse':
    case 'PostToolUse': {
      const target = input.file_path ?? input.notebook_path ?? input.command ?? input.pattern ?? input.url ?? input.query ?? input.description;
      return target === undefined ? {} : { target: clip(String(target), 160) };
    }
    case 'Notification':
      return { message: clip(p.message, 200) };
    case 'SessionStart':
      return { source: p.source };
    case 'SessionEnd':
      return { reason: p.reason };
    default:
      return {};
  }
}

export function modelName(model: unknown): string | undefined {
  if (typeof model === 'string') return model;
  if (model && typeof model === 'object') {
    const m = model as { id?: unknown; display_name?: unknown };
    if (typeof m.id === 'string') return m.id;
    if (typeof m.display_name === 'string') return m.display_name;
  }
  return undefined;
}

/** Events that should trigger a usage refresh from the transcript. */
export const USAGE_EVENTS = new Set(['Stop', 'SubagentStop', 'SessionEnd', 'PreCompact', 'PostToolUse', 'UserPromptSubmit']);
/** Events kept in agent_events (PreToolUse is folded into the session row only). */
export const STORED_EVENTS = (e: string) => e !== 'PreToolUse';
