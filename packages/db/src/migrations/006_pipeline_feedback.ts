import { type Kysely, sql } from 'kysely';

/** One labeled example per verified run: what was predicted/chosen, and whether the result was right. */
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('pipeline_feedback')
    .addColumn('id', 'uuid', c => c.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('run_id', 'uuid', c => c.notNull().unique().references('pipeline_runs.id').onDelete('cascade'))
    .addColumn('task_id', 'uuid', c => c.notNull().references('tasks.id').onDelete('cascade'))
    .addColumn('task_key', 'text')
    .addColumn('issue_type', 'text') // Jira issue type
    .addColumn('classification', 'jsonb') // what the classifier said
    .addColumn('classification_engine', 'text')
    .addColumn('decision', 'jsonb') // what the user chose
    .addColumn('playbook_id', 'text')
    .addColumn('classification_accepted', 'boolean') // user kept the suggested type + playbook
    .addColumn('outcome', 'boolean', c => c.notNull()) // verified true / false
    .addColumn('note', 'text')
    .addColumn('signal', 'text')
    .addColumn('cost_usd', 'double precision')
    .addColumn('files_changed', 'integer')
    .addColumn('created_at', 'timestamptz', c => c.notNull().defaultTo(sql`now()`))
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('pipeline_feedback').execute();
}
