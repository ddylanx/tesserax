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
