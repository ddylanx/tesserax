import { type Kysely, sql } from 'kysely';

/** Release (Jira fixVersion, or a phase name on local tasks) for board swimlanes. */
export async function up(db: Kysely<any>): Promise<void> {
  await sql`alter table tasks add column if not exists release text`.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`alter table tasks drop column if exists release`.execute(db);
}
