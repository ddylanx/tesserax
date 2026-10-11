import { type Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('tasks')
    .addColumn('id', 'uuid', c => c.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('workspace_id', 'uuid', c => c.notNull().references('workspaces.id').onDelete('cascade'))
    .addColumn('source_id', 'uuid', c => c.notNull().references('sources.id').onDelete('cascade'))
    .addColumn('external_id', 'text', c => c.notNull())
    .addColumn('key', 'text') // e.g. PAY-412
    .addColumn('title', 'text', c => c.notNull())
    .addColumn('status', 'text')
    .addColumn('status_category', 'text', c => c.notNull().defaultTo('todo')) // todo | in_progress | done
    .addColumn('priority', 'text')
    .addColumn('assignee', 'text')
    .addColumn('project', 'text')
    .addColumn('type', 'text')
    .addColumn('labels', sql`text[]`, c => c.notNull().defaultTo(sql`'{}'`))
    .addColumn('url', 'text')
    .addColumn('due_at', 'date')
    .addColumn('created_at_source', 'timestamptz')
    .addColumn('updated_at_source', 'timestamptz')
    .addColumn('raw', 'jsonb', c => c.notNull().defaultTo(sql`'{}'::jsonb`))
    .addColumn('synced_at', 'timestamptz', c => c.notNull().defaultTo(sql`now()`))
    .addColumn('archived_at', 'timestamptz') // no longer returned by the source query
    .addColumn('created_at', 'timestamptz', c => c.notNull().defaultTo(sql`now()`))
    .addUniqueConstraint('tasks_source_external_uq', ['source_id', 'external_id'])
    .execute();
  await db.schema.createIndex('tasks_workspace_idx').on('tasks').columns(['workspace_id', 'status_category', 'updated_at_source']).execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('tasks').execute();
}
