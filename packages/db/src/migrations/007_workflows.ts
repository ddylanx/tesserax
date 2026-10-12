import { type Kysely, sql } from 'kysely';

export const ACTIVE_RUN_STATUSES = ['running', 'waiting', 'failed'];

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('workflow_runs')
    .addColumn('id', 'uuid', c => c.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('task_id', 'uuid', c => c.notNull().references('tasks.id').onDelete('cascade'))
    .addColumn('workflow_id', 'text', c => c.notNull())
    .addColumn('workflow_hash', 'text', c => c.notNull())
    .addColumn('workflow_snapshot', 'jsonb', c => c.notNull()) // the graph as it was when the run started
    .addColumn('trigger', 'text', c => c.notNull()) // new_issue | manual
    .addColumn('status', 'text', c => c.notNull().defaultTo('running')) // running | waiting | failed | done | cancelled
    .addColumn('current_node_id', 'text')
    .addColumn('repo_path', 'text')
    .addColumn('base_ref', 'text')
    .addColumn('branch', 'text')
    .addColumn('worktree_path', 'text')
    .addColumn('error', 'text')
    .addColumn('created_at', 'timestamptz', c => c.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', c => c.notNull().defaultTo(sql`now()`))
    .addColumn('finished_at', 'timestamptz')
    .execute();
  await sql`create unique index workflow_runs_one_active_per_task on workflow_runs (task_id)
    where status in (${sql.join(ACTIVE_RUN_STATUSES.map(s => sql.lit(s)))})`.execute(db);

  await db.schema
    .createTable('node_runs')
    .addColumn('id', 'uuid', c => c.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('run_id', 'uuid', c => c.notNull().references('workflow_runs.id').onDelete('cascade'))
    .addColumn('seq', 'integer', c => c.notNull()) // order within the run
    .addColumn('node_id', 'text', c => c.notNull())
    .addColumn('node_type', 'text', c => c.notNull())
    .addColumn('attempt', 'integer', c => c.notNull().defaultTo(1)) // how many times this node has run in this run
    .addColumn('via_edge', 'text') // edge that led here (for loop limits)
    .addColumn('status', 'text', c => c.notNull().defaultTo('queued')) // queued | running | waiting | done | failed | cancelled
    .addColumn('port', 'text')
    .addColumn('input', 'jsonb', c => c.notNull().defaultTo(sql`'{}'::jsonb`))
    .addColumn('output', 'jsonb', c => c.notNull().defaultTo(sql`'{}'::jsonb`))
    .addColumn('error', 'text')
    .addColumn('skill_hash', 'text')
    .addColumn('cost_usd', 'double precision')
    .addColumn('num_turns', 'integer')
    .addColumn('agent_session_id', 'text')
    .addColumn('process_id', 'integer')
    .addColumn('run_dir', 'text')
    .addColumn('created_at', 'timestamptz', c => c.notNull().defaultTo(sql`now()`))
    .addColumn('started_at', 'timestamptz')
    .addColumn('ended_at', 'timestamptz')
    .addColumn('waiting_ms', 'bigint') // time spent waiting for the user (gates)
    .addUniqueConstraint('node_runs_run_seq_uq', ['run_id', 'seq'])
    .execute();
  await db.schema.createIndex('node_runs_run_idx').on('node_runs').columns(['run_id', 'node_id']).execute();

  await db.schema
    .createTable('artifacts')
    .addColumn('id', 'uuid', c => c.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('run_id', 'uuid', c => c.notNull().references('workflow_runs.id').onDelete('cascade'))
    .addColumn('node_run_id', 'uuid', c => c.references('node_runs.id').onDelete('set null'))
    .addColumn('name', 'text', c => c.notNull()) // analysis, spec, checks, review, implementation, ...
    .addColumn('version', 'integer', c => c.notNull())
    .addColumn('author', 'text', c => c.notNull()) // ai | user
    .addColumn('content', 'text', c => c.notNull())
    .addColumn('created_at', 'timestamptz', c => c.notNull().defaultTo(sql`now()`))
    .addUniqueConstraint('artifacts_run_name_version_uq', ['run_id', 'name', 'version'])
    .execute();

  await db.schema
    .createTable('run_events')
    .addColumn('id', 'bigserial', c => c.primaryKey())
    .addColumn('run_id', 'uuid', c => c.notNull().references('workflow_runs.id').onDelete('cascade'))
    .addColumn('node_run_id', 'uuid')
    .addColumn('actor', 'text', c => c.notNull())
    .addColumn('action', 'text', c => c.notNull())
    .addColumn('detail', 'jsonb', c => c.notNull().defaultTo(sql`'{}'::jsonb`))
    .addColumn('correlation_id', 'text')
    .addColumn('created_at', 'timestamptz', c => c.notNull().defaultTo(sql`now()`))
    .execute();
  await db.schema.createIndex('run_events_run_idx').on('run_events').columns(['run_id', 'id']).execute();

  await db.schema
    .createTable('evaluations')
    .addColumn('run_id', 'uuid', c => c.primaryKey().references('workflow_runs.id').onDelete('cascade'))
    .addColumn('scores', 'jsonb', c => c.notNull())
    .addColumn('note', 'text')
    .addColumn('created_at', 'timestamptz', c => c.notNull().defaultTo(sql`now()`))
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  for (const t of ['evaluations', 'run_events', 'artifacts', 'node_runs', 'workflow_runs']) await db.schema.dropTable(t).execute();
}
