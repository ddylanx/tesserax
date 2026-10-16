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

export const systemInfoSchema = z.object({
  health: healthSchema,
  schedules: z.array(scheduleInfoSchema),
  integrations: z.array(z.object({ name: z.string(), configured: z.boolean(), note: z.string().optional() })),
});
export type SystemInfo = z.infer<typeof systemInfoSchema>;
