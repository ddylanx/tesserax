import { z } from 'zod';

export const taskStatusCategorySchema = z.enum(['todo', 'in_progress', 'done']);

export const taskSchema = z.object({
  id: z.string(),
  workspace: z.string(), // workspace slug
  source: z.string(), // jira | google_tasks
  key: z.string().nullable(),
  title: z.string(),
  status: z.string().nullable(),
  statusCategory: taskStatusCategorySchema,
  priority: z.string().nullable(),
  assignee: z.string().nullable(),
  project: z.string().nullable(),
  type: z.string().nullable(),
  labels: z.array(z.string()),
  url: z.string().nullable(),
  dueAt: z.string().nullable(),
  updatedAt: z.string().nullable(),
  archived: z.boolean(),
});
export type TaskDto = z.infer<typeof taskSchema>;

export const taskQuerySchema = z.object({
  workspace: z.string().optional(),
  source: z.string().optional(),
  statusCategory: taskStatusCategorySchema.optional(),
  project: z.string().optional(),
  q: z.string().optional(),
  includeDone: z.enum(['0', '1']).optional(),
  includeArchived: z.enum(['0', '1']).optional(),
});
export type TaskQuery = z.infer<typeof taskQuerySchema>;

export const taskSourceSchema = z.object({
  id: z.string(),
  workspace: z.string(),
  kind: z.string(),
  name: z.string(),
  lastSyncedAt: z.string().nullable(),
  lastError: z.string().nullable(),
  taskCount: z.number(),
});

export const taskListSchema = z.object({
  tasks: z.array(taskSchema),
  projects: z.array(z.string()),
  sources: z.array(taskSourceSchema),
  jiraConfigured: z.boolean(),
});
export type TaskList = z.infer<typeof taskListSchema>;

export const taskDetailSchema = taskSchema.extend({
  description: z.string().nullable(),
  reporter: z.string().nullable(),
  components: z.array(z.string()),
  parent: z.string().nullable(),
  sprint: z.string().nullable(),
  createdAt: z.string().nullable(),
  comments: z.array(z.object({ author: z.string().nullable(), created: z.string().nullable(), body: z.string() })),
  attachments: z.array(
    z.object({ filename: z.string(), mimeType: z.string().nullable(), size: z.number().nullable(), created: z.string().nullable(), author: z.string().nullable() }),
  ),
});
export type TaskDetailDto = z.infer<typeof taskDetailSchema>;
