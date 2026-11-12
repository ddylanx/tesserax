import { type Kysely, sql } from 'kysely';

/** The step report a role-driven step ends with (parsed): summary (<= 5 lines), confidence, and what needs deciding. */
export async function up(db: Kysely<any>): Promise<void> {
  await sql`alter table node_runs add column if not exists summary text`.execute(db);
  await sql`alter table node_runs add column if not exists confidence text`.execute(db);
  await sql`alter table node_runs add column if not exists decision_needed text`.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`alter table node_runs drop column if exists decision_needed`.execute(db);
  await sql`alter table node_runs drop column if exists confidence`.execute(db);
  await sql`alter table node_runs drop column if exists summary`.execute(db);
}
