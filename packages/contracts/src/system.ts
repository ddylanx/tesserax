import { z } from 'zod';

export const healthSchema = z.object({
  status: z.enum(['ok', 'degraded']),
  db: z.enum(['ok', 'down']),
  queue: z.enum(['ok', 'down']),
  uptimeSeconds: z.number(),
  time: z.string(),
});
export type Health = z.infer<typeof healthSchema>;


export const scheduleInfoSchema = z.object({
  name: z.string(),
  cron: z.string(),
  enabled: z.boolean(),
  jitterSeconds: z.number(),
});

export const agentCliStatusSchema = z.object({
  id: z.enum(['claude', 'gemini', 'antigravity']),
  name: z.string(),
  installed: z.boolean(),
  signedIn: z.enum(['yes', 'no', 'unknown']),
  signInCommand: z.string(),
});
export type AgentCliStatus = z.infer<typeof agentCliStatusSchema>;

export const environmentStatusSchema = z.object({
  postgres: z.enum(['ok', 'down']),
  git: z.boolean(),
  agents: z.array(agentCliStatusSchema),
  ready: z.boolean(),
});
export type EnvironmentStatus = z.infer<typeof environmentStatusSchema>;

export const systemInfoSchema = z.object({
  health: healthSchema,
  schedules: z.array(scheduleInfoSchema),
  integrations: z.array(z.object({ name: z.string(), configured: z.boolean(), note: z.string().optional() })),
  environment: environmentStatusSchema,
});
export type SystemInfo = z.infer<typeof systemInfoSchema>;

