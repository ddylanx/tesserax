import { type Kysely, sql } from 'kysely';

/**
 * Team page: departments group roles (sub agent setups that workflow nodes name by `<department>/<role>`).
 * team_role_changes is the audit trail of role edits. Row level security is on with no policies: only the api's own
 * database role (the table owner) reads these tables, never a public client.
 * node_runs keeps the role a step used and the hash of its prompt + config at that time.
 */
export async function up(db: Kysely<any>): Promise<void> {
  await sql`
    create table if not exists team_departments (
      id uuid primary key default gen_random_uuid(),
      slug text not null unique,
      name text not null,
      color text not null default '#64748b',
      description text not null default '',
      position int not null default 0,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
  `.execute(db);
  await sql`
    create table if not exists team_roles (
      id uuid primary key default gen_random_uuid(),
      department_id uuid not null references team_departments(id) on delete restrict,
      slug text not null,
      title text not null,
      prompt text not null default '',
      config jsonb not null default '{}'::jsonb,
      enabled boolean not null default true,
      position int not null default 0,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      unique (department_id, slug)
    );
  `.execute(db);
  await sql`
    create table if not exists team_role_changes (
      id uuid primary key default gen_random_uuid(),
      role_id uuid,
      role_key text not null,
      old_hash text,
      new_hash text,
      action text not null,
      at timestamptz not null default now()
    );
  `.execute(db);
  await sql`create index if not exists team_role_changes_role_idx on team_role_changes (role_id, at desc)`.execute(db);
  await sql`alter table team_departments enable row level security`.execute(db);
  await sql`alter table team_roles enable row level security`.execute(db);
  await sql`alter table team_role_changes enable row level security`.execute(db);
  await sql`alter table node_runs add column if not exists role text`.execute(db);
  await sql`alter table node_runs add column if not exists role_hash text`.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`alter table node_runs drop column if exists role_hash`.execute(db);
  await sql`alter table node_runs drop column if exists role`.execute(db);
  await sql`drop table if exists team_role_changes`.execute(db);
  await sql`drop table if exists team_roles`.execute(db);
  await sql`drop table if exists team_departments`.execute(db);
}
