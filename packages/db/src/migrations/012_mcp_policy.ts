import { type Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await sql`
    create table if not exists mcp_policy (
      server text primary key,
      mode text not null check (mode in ('off', 'all', 'tools')),
      tools jsonb not null default '[]'::jsonb,
      engines jsonb not null default '["claude","antigravity","gemini"]'::jsonb,
      updated_at timestamptz not null default now()
    );
  `.execute(db);

  await sql`
    create table if not exists mcp_tool_cache (
      server text primary key,
      tools jsonb not null default '[]'::jsonb,
      read_at timestamptz not null default now()
    );
  `.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`drop table if exists mcp_tool_cache`.execute(db);
  await sql`drop table if exists mcp_policy`.execute(db);
}
