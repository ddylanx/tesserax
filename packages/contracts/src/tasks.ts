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
  /** Release or phase (Jira fixVersion); board swimlanes group by it. */
  release: z.string().nullable(),
  sprint: z.string().nullable(),
  /** Parent issue (epic), "KEY summary". */
  parent: z.string().nullable(),
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
  /** ISO date-time: only tasks with updated_at_source >= it. */
  updatedSince: z.iso.datetime({ offset: true }).optional(),
  /** Page size; when set, the list is paged by updatedAt (newest first). 1–500. */
  limit: z.coerce.number().int().min(1).max(500).optional(),
  /** Opaque cursor: nextCursor of the previous page. */
  cursor: z.string().max(300).optional(),
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
  /** Next page; null on the last page or when not paged. */
  nextCursor: z.string().nullable(),
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
  /** Release or phase name; empty clears it. */
  release: z.string().trim().max(100).optional(),
  dueAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  review: reviewTargetSchema.optional(),
});
export type CreateLocalTask = z.infer<typeof createLocalTaskSchema>;

export const updateLocalTaskSchema = createLocalTaskSchema
  .omit({ projectSlug: true })
  .partial()
  .extend({ statusCategory: z.enum(['todo', 'in_progress', 'done']).optional(), review: reviewTargetSchema.nullable().optional() });
export type UpdateLocalTask = z.infer<typeof updateLocalTaskSchema>;

export const updateTaskStatusSchema = z.object({
  statusCategory: taskStatusCategorySchema,
  status: z.string().min(1).max(100).optional(),
});
export type UpdateTaskStatus = z.infer<typeof updateTaskStatusSchema>;

export const taskDetailSchema = taskSchema.extend({
  description: z.string().nullable(),
  reporter: z.string().nullable(),
  components: z.array(z.string()),
  createdAt: z.string().nullable(),
  review: reviewTargetSchema.nullable(),
  comments: z.array(z.object({ author: z.string().nullable(), created: z.string().nullable(), body: z.string() })),
  attachments: z.array(
    z.object({ filename: z.string(), mimeType: z.string().nullable(), size: z.number().nullable(), created: z.string().nullable(), author: z.string().nullable() }),
  ),
});
export type TaskDetailDto = z.infer<typeof taskDetailSchema>;
