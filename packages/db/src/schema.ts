import type { ColumnType, Generated, Insertable, Selectable, Updateable } from 'kysely';

type Timestamp = ColumnType<Date, Date | string | undefined, Date | string>;
type Json = ColumnType<unknown, unknown, unknown>;

export interface WorkspacesTable {
  id: Generated<string>;
  slug: string;
  name: string;
  kind: 'personal' | 'company';
  created_at: Generated<Date>;
}

export interface SourcesTable {
  id: Generated<string>;
  workspace_id: string;
  kind: string; // jira | google_tasks | ...
  name: string;
  config: Json;
  last_synced_at: Timestamp | null;
  last_error: string | null;
  created_at: Generated<Date>;
}

export interface Database {
  workspaces: WorkspacesTable;
  sources: SourcesTable;
}

export type Workspace = Selectable<WorkspacesTable>;
export type NewWorkspace = Insertable<WorkspacesTable>;
export type Source = Selectable<SourcesTable>;
export type SourceUpdate = Updateable<SourcesTable>;
