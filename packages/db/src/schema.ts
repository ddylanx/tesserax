import type { ColumnType, Generated, Insertable, Selectable, Updateable } from 'kysely';

type Timestamp = ColumnType<Date, Date | string | undefined, Date | string>;
type Json = ColumnType<unknown, unknown, unknown>;

export interface ProjectsTable {
  id: Generated<string>;
  slug: string;
  name: string;
  kind: 'personal' | 'company';
  color: Generated<string>;
  position: Generated<number>;
  is_default: Generated<boolean>;
  settings: ColumnType<unknown, unknown | undefined, unknown>;
  created_at: Generated<Date>;
}

export interface SourcesTable {
  id: Generated<string>;
  project_id: string;
  kind: string; // jira | google_tasks | ...
  name: string;
  config: Json;
  last_synced_at: Timestamp | null;
  last_error: string | null;
  created_at: Generated<Date>;
}

type BigCount = ColumnType<string | null, number | string | null | undefined, number | string | null>;

export interface AgentsTable {
  id: Generated<string>;
  kind: string;
  host: string;
  name: string;
  created_at: Generated<Date>;
  last_seen_at: Generated<Date>;
}

export type AgentSessionStatus = 'running' | 'waiting' | 'idle' | 'ended';

export interface AgentSessionsTable {
  id: Generated<string>;
  agent_id: string;
  /** Set from the session's folder (workplace or run worktree); null = not in a project. */
  project_id: string | null;
  session_id: string;
  cwd: string | null;
  branch: string | null;
  transcript_path: string | null;
  model: string | null;
  permission_mode: string | null;
  status: ColumnType<AgentSessionStatus, AgentSessionStatus | undefined, AgentSessionStatus>;
  last_event: string | null;
  last_tool: string | null;
  last_prompt: string | null;
  last_message: string | null;
  prompt_count: Generated<number>;
  tool_count: Generated<number>;
  input_tokens: BigCount;
  output_tokens: BigCount;
  cache_read_tokens: BigCount;
  cache_creation_tokens: BigCount;
  context_tokens: BigCount;
  usage_updated_at: Timestamp | null;
  started_at: Generated<Date>;
  last_event_at: Generated<Date>;
  ended_at: Timestamp | null;
  end_reason: string | null;
}

export interface AgentEventsTable {
  id: Generated<string>;
  agent_session_id: string;
  event: string;
  tool_name: string | null;
  detail: Json;
  correlation_id: string | null;
  received_at: Generated<Date>;
}

export interface McpPolicyTable {
  server: string;
  mode: string; // 'off' | 'all' | 'tools'
  tools: Json; // string[]
  engines: Json; // ('claude' | 'antigravity' | 'gemini')[]
  updated_at: Generated<Date>;
}

export interface McpToolCacheTable {
  server: string;
  tools: Json; // { name: string; description?: string }[]
  read_at: Generated<Date>;
}

export type TaskStatusCategory = 'todo' | 'in_progress' | 'done';

export interface TasksTable {
  id: Generated<string>;
  project_id: string;
  /** Moved to this project by hand: sync never moves it. */
  project_pinned: Generated<boolean>;
  source_id: string;
  external_id: string;
  key: string | null;
  title: string;
  status: string | null;
  status_category: ColumnType<TaskStatusCategory, TaskStatusCategory | undefined, TaskStatusCategory>;
  priority: string | null;
  assignee: string | null;
  reporter: string | null;
  project: string | null;
  type: string | null;
  labels: ColumnType<string[], string[] | undefined, string[]>;
  components: ColumnType<string[], string[] | undefined, string[]>;
  description: string | null;
  parent: string | null;
  sprint: string | null;
  comments: Json;
  attachments: Json;
  detail_synced_at: Timestamp | null;
  review: Json | null;
  workplace_id: string | null;
  url: string | null;
  due_at: ColumnType<Date | null, string | null | undefined, string | null>;
  created_at_source: Timestamp | null;
  updated_at_source: Timestamp | null;
  raw: Json;
  synced_at: Timestamp;
  archived_at: Timestamp | null;
  created_at: Generated<Date>;
}

export type PipelineState =
  | 'new' | 'classifying' | 'awaiting_decision' | 'rejected' | 'queued' | 'running_playbook'
  | 'awaiting_verify' | 'verified_true' | 'verified_false' | 'failed' | 'cancelled';

export interface PipelineRunsTable {
  id: Generated<string>;
  task_id: string;
  trigger: string;
  state: ColumnType<PipelineState, PipelineState | undefined, PipelineState>;
  attempt: Generated<number>;
  classification: Json | null;
  classification_engine: string | null;
  decision: Json | null;
  playbook_id: string | null;
  repo_path: string | null;
  branch: string | null;
  worktree_path: string | null;
  agent_session_id: string | null;
  process_id: number | null;
  run_dir: string | null;
  result: Json | null;
  error: string | null;
  error_step: string | null;
  verify_note: string | null;
  jira_comment_id: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
  state_changed_at: Generated<Date>;
}

export interface PipelineEventsTable {
  id: Generated<string>;
  run_id: string;
  from_state: string | null;
  to_state: string | null;
  actor: string;
  action: string;
  detail: Json;
  correlation_id: string | null;
  created_at: Generated<Date>;
}

export interface PipelineFeedbackTable {
  id: Generated<string>;
  run_id: string;
  task_id: string;
  task_key: string | null;
  issue_type: string | null;
  classification: Json | null;
  classification_engine: string | null;
  decision: Json | null;
  playbook_id: string | null;
  classification_accepted: boolean | null;
  outcome: boolean;
  note: string | null;
  signal: string | null;
  cost_usd: number | null;
  files_changed: number | null;
  created_at: Generated<Date>;
}

export type WorkflowRunStatus = 'running' | 'waiting' | 'failed' | 'done' | 'cancelled';
export type NodeRunStatus = 'queued' | 'running' | 'waiting' | 'done' | 'failed' | 'cancelled';

export interface WorkflowRunsTable {
  id: Generated<string>;
  task_id: string;
  project_id: string | null;
  workflow_id: string;
  workflow_hash: string;
  workflow_snapshot: Json;
  trigger: string;
  status: ColumnType<WorkflowRunStatus, WorkflowRunStatus | undefined, WorkflowRunStatus>;
  current_node_id: string | null;
  repo_path: string | null;
  base_ref: string | null;
  branch: string | null;
  worktree_path: string | null;
  error: string | null;
  vars: ColumnType<unknown, unknown | undefined, unknown>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
  finished_at: Timestamp | null;
}

export interface NodeRunsTable {
  id: Generated<string>;
  run_id: string;
  seq: number;
  node_id: string;
  node_type: string;
  attempt: Generated<number>;
  via_edge: string | null;
  status: ColumnType<NodeRunStatus, NodeRunStatus | undefined, NodeRunStatus>;
  port: string | null;
  input: Json;
  output: Json;
  error: string | null;
  skill_hash: string | null;
  cost_usd: number | null;
  num_turns: number | null;
  agent_session_id: string | null;
  process_id: number | null;
  run_dir: string | null;
  created_at: Generated<Date>;
  started_at: Timestamp | null;
  ended_at: Timestamp | null;
  waiting_ms: BigCount;
}

export interface ArtifactsTable {
  id: Generated<string>;
  run_id: string;
  node_run_id: string | null;
  name: string;
  version: number;
  author: 'ai' | 'user';
  content: string;
  created_at: Generated<Date>;
}

export interface RunEventsTable {
  id: Generated<string>;
  run_id: string;
  node_run_id: string | null;
  actor: string;
  action: string;
  detail: Json;
  correlation_id: string | null;
  created_at: Generated<Date>;
}

export interface EvaluationsTable {
  run_id: string;
  scores: Json;
  note: string | null;
  created_at: Generated<Date>;
}

export interface Database {
  workflow_runs: WorkflowRunsTable;
  node_runs: NodeRunsTable;
  artifacts: ArtifactsTable;
  run_events: RunEventsTable;
  evaluations: EvaluationsTable;
  pipeline_feedback: PipelineFeedbackTable;
  pipeline_runs: PipelineRunsTable;
  pipeline_events: PipelineEventsTable;
  tasks: TasksTable;
  projects: ProjectsTable;
  sources: SourcesTable;
  agents: AgentsTable;
  agent_sessions: AgentSessionsTable;
  agent_events: AgentEventsTable;
  mcp_policy: McpPolicyTable;
  mcp_tool_cache: McpToolCacheTable;
}

export type ProjectRow = Selectable<ProjectsTable>;
export type NewProject = Insertable<ProjectsTable>;
export type Source = Selectable<SourcesTable>;
export type SourceUpdate = Updateable<SourcesTable>;
export type AgentSession = Selectable<AgentSessionsTable>;
export type AgentSessionUpdate = Updateable<AgentSessionsTable>;
export type Task = Selectable<TasksTable>;
export type NewTask = Insertable<TasksTable>;
export type PipelineRun = Selectable<PipelineRunsTable>;
export type PipelineRunUpdate = Updateable<PipelineRunsTable>;
export type WorkflowRun = Selectable<WorkflowRunsTable>;
export type WorkflowRunUpdate = Updateable<WorkflowRunsTable>;
export type NodeRun = Selectable<NodeRunsTable>;
export type NodeRunUpdate = Updateable<NodeRunsTable>;
export type McpPolicyRow = Selectable<McpPolicyTable>;
export type NewMcpPolicy = Insertable<McpPolicyTable>;
export type McpPolicyUpdate = Updateable<McpPolicyTable>;
export type McpToolCacheRow = Selectable<McpToolCacheTable>;
export type NewMcpToolCache = Insertable<McpToolCacheTable>;
