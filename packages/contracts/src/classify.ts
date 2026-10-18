import { z } from 'zod';

export const ISSUE_TYPES = ['bug', 'feature', 'chore', 'research', 'question', 'review'] as const;
export const AUTOMATION_LEVELS = ['auto', 'assisted', 'manual'] as const;

export const classificationSchema = z.object({
  type: z.enum(ISSUE_TYPES),
  automation: z.enum(AUTOMATION_LEVELS),
  repo: z.string().nullable(),
  confidence: z.number().min(0).max(1),
  reasoning: z.string().max(1000),
});
export type Classification = z.infer<typeof classificationSchema>;
