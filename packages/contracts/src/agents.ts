import { z } from 'zod';

/** Claude Code hook payload (stdin of a "command" hook). Unknown fields are kept but ignored. */
export const claudeHookPayloadSchema = z.looseObject({
  hook_event_name: z.string().min(1),
  session_id: z.string().min(1),
  cwd: z.string().optional(),
  transcript_path: z.string().optional(),
  permission_mode: z.string().optional(),
  model: z.unknown().optional(),
  source: z.string().optional(), // SessionStart: startup | resume | clear | compact
  reason: z.string().optional(), // SessionEnd
  prompt: z.string().optional(), // UserPromptSubmit
  message: z.string().optional(), // Notification
  tool_name: z.string().optional(),
  tool_input: z.unknown().optional(),
});
export type ClaudeHookPayload = z.infer<typeof claudeHookPayloadSchema>;

export const agentSessionStatusSchema = z.enum(['running', 'waiting', 'idle', 'ended']);
export type AgentSessionStatusDto = z.infer<typeof agentSessionStatusSchema>;

export const agentSessionSchema = z.object({
  id: z.string(),
  agentKind: z.string(),
  host: z.string(),
  sessionId: z.string(),
  cwd: z.string().nullable(),
  /** Folder name of the cwd. */
  project: z.string().nullable(),
  /** The Tesserax project the folder belongs to (workplace or run worktree); null = not in a project. */
  projectSlug: z.string().nullable().optional(),
  projectColor: z.string().nullable().optional(),
  branch: z.string().nullable(),
  model: z.string().nullable(),
  permissionMode: z.string().nullable(),
  status: agentSessionStatusSchema,
  stale: z.boolean(),
  lastEvent: z.string().nullable(),
  lastTool: z.string().nullable(),
  lastPrompt: z.string().nullable(),
  lastMessage: z.string().nullable(),
  promptCount: z.number(),
  toolCount: z.number(),
  usage: z
    .object({
      inputTokens: z.number(),
      outputTokens: z.number(),
      cacheReadTokens: z.number(),
      cacheCreationTokens: z.number(),
      contextTokens: z.number().nullable(),
      updatedAt: z.string(),
    })
    .nullable(),
  startedAt: z.string(),
  lastEventAt: z.string(),
  endedAt: z.string().nullable(),
  endReason: z.string().nullable(),
});
export type AgentSessionDto = z.infer<typeof agentSessionSchema>;

export const agentSessionListSchema = z.object({
  sessions: z.array(agentSessionSchema),
  counts: z.record(z.string(), z.number()),
  lastEventAt: z.string().nullable(),
});
export type AgentSessionList = z.infer<typeof agentSessionListSchema>;

export const agentEventSchema = z.object({
  id: z.string(),
  event: z.string(),
  toolName: z.string().nullable(),
  detail: z.record(z.string(), z.unknown()),
  receivedAt: z.string(),
});
export type AgentEventDto = z.infer<typeof agentEventSchema>;
