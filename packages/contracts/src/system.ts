import { z } from 'zod';

export const healthSchema = z.object({
  status: z.enum(['ok', 'degraded']),
  db: z.enum(['ok', 'down']),
  queue: z.enum(['ok', 'down']),
  uptimeSeconds: z.number(),
  time: z.string(),
});
export type Health = z.infer<typeof healthSchema>;

export const workspaceSchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  kind: z.enum(['personal', 'company']),
});
export type WorkspaceDto = z.infer<typeof workspaceSchema>;

export const scheduleInfoSchema = z.object({
  name: z.string(),
  cron: z.string(),
  enabled: z.boolean(),
  jitterSeconds: z.number(),
});

export const systemInfoSchema = z.object({
  health: healthSchema,
  workspaces: z.array(workspaceSchema),
  schedules: z.array(scheduleInfoSchema),
  integrations: z.array(z.object({ name: z.string(), configured: z.boolean(), note: z.string().optional() })),
});
export type SystemInfo = z.infer<typeof systemInfoSchema>;
