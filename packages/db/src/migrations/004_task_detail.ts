import { type Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('tasks')
    .addColumn('reporter', 'text')
    .addColumn('components', sql`text[]`, c => c.notNull().defaultTo(sql`'{}'`))
    .addColumn('description', 'text')
    .addColumn('parent', 'text')
    .addColumn('sprint', 'text')
    .addColumn('comments', 'jsonb', c => c.notNull().defaultTo(sql`'[]'::jsonb`))
    .addColumn('attachments', 'jsonb', c => c.notNull().defaultTo(sql`'[]'::jsonb`))
    .addColumn('detail_synced_at', 'timestamptz')
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  for (const c of ['reporter', 'components', 'description', 'parent', 'sprint', 'comments', 'attachments', 'detail_synced_at']) {
    await db.schema.alterTable('tasks').dropColumn(c).execute();
  }
}
