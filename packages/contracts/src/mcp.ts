import { z } from 'zod';

export const mcpServerSchema = z.object({
  id: z.string(),
  name: z.string(),
  client: z.string(), // Claude Code, Cursor, Claude Desktop, Codex CLI, Gemini CLI, Antigravity
  scope: z.string(), // user | local:<dir> | project:<dir>
  file: z.string(),
  transport: z.string(), // stdio | http | sse
  target: z.string(), // host for remote servers, command basename for stdio
  enabled: z.boolean(),
  envKeys: z.array(z.string()), // names only, never values
});
export type McpServerDto = z.infer<typeof mcpServerSchema>;

export const mcpListSchema = z.object({
  provider: z.string(),
  generatedAt: z.string(),
  servers: z.array(mcpServerSchema),
});
export type McpList = z.infer<typeof mcpListSchema>;

export const mcpPolicyModeSchema = z.enum(['off', 'all', 'tools']);
export type McpPolicyMode = z.infer<typeof mcpPolicyModeSchema>;

export const mcpEngineSchema = z.enum(['claude', 'antigravity', 'gemini']);
export type McpEngine = z.infer<typeof mcpEngineSchema>;

export const mcpPolicySchema = z.object({
  server: z.string(),
  mode: mcpPolicyModeSchema,
  tools: z.array(z.string()).default([]),
  engines: z.array(mcpEngineSchema).default(['claude', 'antigravity', 'gemini']),
  updatedAt: z.string().optional(),
});
export type McpPolicy = z.infer<typeof mcpPolicySchema>;

export const mcpToolItemSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
});
export type McpToolItem = z.infer<typeof mcpToolItemSchema>;

export const mcpToolCacheSchema = z.object({
  server: z.string(),
  tools: z.array(mcpToolItemSchema),
  readAt: z.string(),
});
export type McpToolCache = z.infer<typeof mcpToolCacheSchema>;

export const mcpGrantServerSchema = z.object({
  name: z.string(),
  definition: z.record(z.string(), z.unknown()),
  tools: z.union([z.literal('*'), z.array(z.string())]),
});
export type McpGrantServer = z.infer<typeof mcpGrantServerSchema>;

export const mcpGrantSchema = z.object({
  servers: z.array(mcpGrantServerSchema),
});
export type McpGrant = z.infer<typeof mcpGrantSchema>;

export const mcpServerPolicyDtoSchema = mcpServerSchema.extend({
  policy: mcpPolicySchema.nullable(),
  cachedTools: z.array(mcpToolItemSchema).nullable(),
  toolsReadAt: z.string().nullable(),
  isProd: z.boolean(),
});
export type McpServerPolicyDto = z.infer<typeof mcpServerPolicyDtoSchema>;

export const updateMcpPolicySchema = z.object({
  mode: mcpPolicyModeSchema,
  tools: z.array(z.string()).optional(),
  engines: z.array(mcpEngineSchema).optional(),
});
export type UpdateMcpPolicyDto = z.infer<typeof updateMcpPolicySchema>;

