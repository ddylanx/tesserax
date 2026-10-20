import { type Kysely, sql } from 'kysely';

/** The model a step's run actually used (reported by the CLI, else the one asked for); null = the CLI's own default. */
export async function up(db: Kysely<any>): Promise<void> {
  await sql`alter table node_runs add column if not exists model text`.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`alter table node_runs drop column if exists model`.execute(db);
}
