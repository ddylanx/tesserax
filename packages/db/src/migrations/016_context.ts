import { type Kysely, sql } from 'kysely';

/**
 * Context page: team_context_packs are pieces of project knowledge a role can read (audience null = every role, pinned =
 * always on for its audience); which packs a role has switched on lives in team_roles.config.context.
 * team_improvements: what a role proposes to do its job better (a lesson, or a pack it asks for). Only a person decides;
 * approved lessons are added to the role's context. Row level security is on with no policies, as for the other team tables.
 */
export async function up(db: Kysely<any>): Promise<void> {
  await sql`
    create table if not exists team_context_packs (
      id uuid primary key default gen_random_uuid(),
      slug text not null unique,
      name text not null,
      description text not null default '',
      body text not null default '',
      source text not null default '',
      audience jsonb,
      pinned boolean not null default false,
      position int not null default 0,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
  `.execute(db);
  await sql`
    create table if not exists team_improvements (
      id uuid primary key default gen_random_uuid(),
      role_id uuid not null references team_roles(id) on delete cascade,
      role_key text not null,
      kind text not null default 'lesson',
      text text not null,
      reason text not null default '',
      pack text,
      source text not null default 'manual',
      status text not null default 'proposed',
      note text not null default '',
      fingerprint text not null,
      created_at timestamptz not null default now(),
      decided_at timestamptz
    );
  `.execute(db);
  await sql`create index if not exists team_improvements_role_idx on team_improvements (role_id, status, created_at desc)`.execute(db);
  await sql`alter table team_context_packs enable row level security`.execute(db);
  await sql`alter table team_improvements enable row level security`.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`drop table if exists team_improvements`.execute(db);
  await sql`drop table if exists team_context_packs`.execute(db);
}
