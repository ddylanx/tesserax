import { z } from 'zod';

export const taskStatusCategorySchema = z.enum(['todo', 'in_progress', 'done']);

export const taskSchema = z.object({
  id: z.string(),
  projectSlug: z.string(),
  projectColor: z.string().optional(),
  /** Moved to its project by hand: sync does not move it. */
  pinned: z.boolean().optional(),
  source: z.string(), // jira | google_tasks | local
  key: z.string().nullable(),
  title: z.string(),
  status: z.string().nullable(),
  statusCategory: taskStatusCategorySchema,
  priority: z.string().nullable(),
  assignee: z.string().nullable(),
  /** Jira key of the board (shown as "Board" in the UI). */
  project: z.string().nullable(),
  type: z.string().nullable(),
  labels: z.array(z.string()),
  url: z.string().nullable(),
  dueAt: z.string().nullable(),
  updatedAt: z.string().nullable(),
  archived: z.boolean(),
  /** Workplace picked for this task (Repos page); null = by project. */
  workplaceId: z.string().nullable().optional(),
});
export type TaskDto = z.infer<typeof taskSchema>;

export const taskQuerySchema = z.object({
  /** Project slug. */
  project: z.string().optional(),
  source: z.string().optional(),
  statusCategory: taskStatusCategorySchema.optional(),
  /** Jira key. */
  board: z.string().optional(),
  q: z.string().optional(),
  includeDone: z.enum(['0', '1']).optional(),
  includeArchived: z.enum(['0', '1']).optional(),
});
export type TaskQuery = z.infer<typeof taskQuerySchema>;

export const taskSourceSchema = z.object({
  id: z.string(),
  projectSlug: z.string(),
  kind: z.string(),
  name: z.string(),
  lastSyncedAt: z.string().nullable(),
  lastError: z.string().nullable(),
  taskCount: z.number(),
});

export const taskListSchema = z.object({
  tasks: z.array(taskSchema),
  /** Jira keys seen on tasks. */
  boards: z.array(z.string()),
  sources: z.array(taskSourceSchema),
  jiraConfigured: z.boolean(),
});
export type TaskList = z.infer<typeof taskListSchema>;

/** For code-review tasks: the member's branch (and PR) to review. */
export const reviewTargetSchema = z.object({
  sourceBranch: z.string().min(1).max(200).regex(/^[\w./-]+$/, 'branch name'),
  targetBranch: z.string().min(1).max(200).regex(/^[\w./-]+$/, 'branch name').optional(),
  prUrl: z.string().url().optional(),
});
export type ReviewTarget = z.infer<typeof reviewTargetSchema>;

export const LOCAL_TASK_TYPES = ['Bug', 'Story', 'Task', 'Question', 'Code review'] as const;

/** "New task": a task kept only in Tesserax, in a project. */
export const createLocalTaskSchema = z.object({
  projectSlug: z.string().min(1).max(60),
  title: z.string().min(1).max(300),
  description: z.string().max(50_000).optional(),
  type: z.enum(LOCAL_TASK_TYPES).default('Task'),
  priority: z.enum(['Highest', 'High', 'Medium', 'Low', 'Lowest']).optional(),
  /** Jira-style project key (routing rules, and the default workplace when none is picked). */
  project: z.string().max(50).optional(),
  /** Workplace (Repos page) the workflow works in. */
  workplaceId: z.string().max(60).nullable().optional(),
  labels: z.array(z.string().min(1).max(50)).max(20).default([]),
  dueAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  review: reviewTargetSchema.optional(),
});
export type CreateLocalTask = z.infer<typeof createLocalTaskSchema>;

export const updateLocalTaskSchema = createLocalTaskSchema
  .omit({ projectSlug: true })
  .partial()
  .extend({ statusCategory: z.enum(['todo', 'in_progress', 'done']).optional(), review: reviewTargetSchema.nullable().optional() });
export type UpdateLocalTask = z.infer<typeof updateLocalTaskSchema>;

export const taskDetailSchema = taskSchema.extend({
  description: z.string().nullable(),
  reporter: z.string().nullable(),
  components: z.array(z.string()),
  parent: z.string().nullable(),
  sprint: z.string().nullable(),
  createdAt: z.string().nullable(),
  review: reviewTargetSchema.nullable(),
  comments: z.array(z.object({ author: z.string().nullable(), created: z.string().nullable(), body: z.string() })),
  attachments: z.array(
    z.object({ filename: z.string(), mimeType: z.string().nullable(), size: z.number().nullable(), created: z.string().nullable(), author: z.string().nullable() }),
  ),
});
export type TaskDetailDto = z.infer<typeof taskDetailSchema>;
