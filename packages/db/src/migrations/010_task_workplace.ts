import { type Kysely } from 'kysely';

/** The workplace (local checkout, per brand) a task's workflow works in; null = the one mapped to its project. */
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema.alterTable('tasks').addColumn('workplace_id', 'text').execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.alterTable('tasks').dropColumn('workplace_id').execute();
}
