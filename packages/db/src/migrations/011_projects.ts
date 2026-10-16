import { type Kysely, sql } from 'kysely';

/**
 * Workspaces become projects: tasks, sources, runs and agent sessions belong to one. Existing rows keep their ids.
 * The default project (receives tasks no rule matches) is "company" when it exists, else the oldest row.
 */
export async function up(db: Kysely<any>): Promise<void> {
  const hasProjects = (await sql<{ n: number }>`select count(*)::int as n from information_schema.tables where table_name = 'projects' and table_schema = current_schema()`.execute(db)).rows[0]!.n > 0;
  if (hasProjects) return;

  await sql`alter table workspaces rename to projects`.execute(db);
  await sql`alter table sources rename column workspace_id to project_id`.execute(db);
  await sql`alter table tasks rename column workspace_id to project_id`.execute(db);
  await sql`alter table projects add column color text not null default '#64748b'`.execute(db);
  await sql`alter table projects add column position int not null default 0`.execute(db);
  await sql`alter table projects add column is_default boolean not null default false`.execute(db);
  await sql`alter table projects add column settings jsonb not null default '{}'::jsonb`.execute(db);
  await sql`update projects set color = case slug when 'company' then '#2563eb' when 'personal' then '#16a34a' else color end`.execute(db);
  await sql`
    update projects p set position = r.n
    from (select id, row_number() over (order by created_at, slug) as n from projects) r
    where r.id = p.id`.execute(db);
  await sql`
    update projects set is_default = true
    where id = (select id from projects order by (slug = 'company') desc, created_at, slug limit 1)`.execute(db);
  await sql`create unique index projects_one_default on projects (is_default) where is_default`.execute(db);

  await sql`alter table tasks add column project_pinned boolean not null default false`.execute(db);
  // what was already placed (non-default projects, local tasks) stays where it is
  await sql`
    update tasks set project_pinned = true
    where project_id <> (select id from projects where is_default)
       or source_id in (select id from sources where kind = 'local')`.execute(db);
  await sql`alter table workflow_runs add column project_id uuid references projects(id) on delete set null`.execute(db);
  await sql`update workflow_runs r set project_id = t.project_id from tasks t where t.id = r.task_id`.execute(db);
  await sql`alter table agent_sessions add column project_id uuid references projects(id) on delete set null`.execute(db);
  await sql`create index workflow_runs_project_idx on workflow_runs (project_id)`.execute(db);
  await sql`create index agent_sessions_project_idx on agent_sessions (project_id)`.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`drop index if exists agent_sessions_project_idx`.execute(db);
  await sql`drop index if exists workflow_runs_project_idx`.execute(db);
  await sql`alter table agent_sessions drop column project_id`.execute(db);
  await sql`alter table workflow_runs drop column project_id`.execute(db);
  await sql`alter table tasks drop column project_pinned`.execute(db);
  await sql`drop index if exists projects_one_default`.execute(db);
  await sql`alter table projects drop column settings, drop column is_default, drop column position, drop column color`.execute(db);
  await sql`alter table tasks rename column project_id to workspace_id`.execute(db);
  await sql`alter table sources rename column project_id to workspace_id`.execute(db);
  await sql`alter table projects rename to workspaces`.execute(db);
}
