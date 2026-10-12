import { type Kysely, sql } from 'kysely';

/** Values computed during a run that later nodes can use (e.g. classification for skip rules). */
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema.alterTable('workflow_runs').addColumn('vars', 'jsonb', c => c.notNull().defaultTo(sql`'{}'::jsonb`)).execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.alterTable('workflow_runs').dropColumn('vars').execute();
}
