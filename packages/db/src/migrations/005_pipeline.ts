import { type Kysely, sql } from 'kysely';

export const ACTIVE_STATES = ['new', 'classifying', 'awaiting_decision', 'queued', 'running_playbook', 'awaiting_verify', 'failed'];

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('pipeline_runs')
    .addColumn('id', 'uuid', c => c.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('task_id', 'uuid', c => c.notNull().references('tasks.id').onDelete('cascade'))
    .addColumn('trigger', 'text', c => c.notNull()) // new_issue | manual
    .addColumn('state', 'text', c => c.notNull().defaultTo('new'))
    .addColumn('attempt', 'integer', c => c.notNull().defaultTo(0)) // bumped each time a step is (re)started
    .addColumn('classification', 'jsonb')
    .addColumn('classification_engine', 'text') // claude-cli | rules
    .addColumn('decision', 'jsonb') // what the user accepted: type, automation, playbookId, repoPath
    .addColumn('playbook_id', 'text')
    .addColumn('repo_path', 'text')
    .addColumn('branch', 'text')
    .addColumn('worktree_path', 'text')
    .addColumn('agent_session_id', 'text') // Claude Code session id passed with --session-id
    .addColumn('process_id', 'integer')
    .addColumn('run_dir', 'text')
    .addColumn('result', 'jsonb') // summary, exit code, diff stats, usage
    .addColumn('error', 'text')
    .addColumn('error_step', 'text')
    .addColumn('verify_note', 'text')
    .addColumn('jira_comment_id', 'text')
    .addColumn('created_at', 'timestamptz', c => c.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', c => c.notNull().defaultTo(sql`now()`))
    .addColumn('state_changed_at', 'timestamptz', c => c.notNull().defaultTo(sql`now()`))
    .execute();
  // One active run per task.
  await sql`create unique index pipeline_runs_one_active_per_task on pipeline_runs (task_id)
    where state in (${sql.join(ACTIVE_STATES.map(s => sql.lit(s)))})`.execute(db);
  await db.schema.createIndex('pipeline_runs_state_idx').on('pipeline_runs').columns(['state', 'state_changed_at']).execute();

  await db.schema
    .createTable('pipeline_events')
    .addColumn('id', 'bigserial', c => c.primaryKey())
    .addColumn('run_id', 'uuid', c => c.notNull().references('pipeline_runs.id').onDelete('cascade'))
    .addColumn('from_state', 'text')
    .addColumn('to_state', 'text')
    .addColumn('actor', 'text', c => c.notNull()) // user | system | job
    .addColumn('action', 'text', c => c.notNull())
    .addColumn('detail', 'jsonb', c => c.notNull().defaultTo(sql`'{}'::jsonb`))
    .addColumn('correlation_id', 'text')
    .addColumn('created_at', 'timestamptz', c => c.notNull().defaultTo(sql`now()`))
    .execute();
  await db.schema.createIndex('pipeline_events_run_idx').on('pipeline_events').columns(['run_id', 'id']).execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('pipeline_events').execute();
  await db.schema.dropTable('pipeline_runs').execute();
}
