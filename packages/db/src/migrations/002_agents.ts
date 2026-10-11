import { type Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('agents')
    .addColumn('id', 'uuid', c => c.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('kind', 'text', c => c.notNull()) // claude-code
    .addColumn('host', 'text', c => c.notNull())
    .addColumn('name', 'text', c => c.notNull())
    .addColumn('created_at', 'timestamptz', c => c.notNull().defaultTo(sql`now()`))
    .addColumn('last_seen_at', 'timestamptz', c => c.notNull().defaultTo(sql`now()`))
    .addUniqueConstraint('agents_kind_host_uq', ['kind', 'host'])
    .execute();

  await db.schema
    .createTable('agent_sessions')
    .addColumn('id', 'uuid', c => c.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('agent_id', 'uuid', c => c.notNull().references('agents.id').onDelete('cascade'))
    .addColumn('session_id', 'text', c => c.notNull()) // the agent's own session id
    .addColumn('cwd', 'text')
    .addColumn('branch', 'text')
    .addColumn('transcript_path', 'text')
    .addColumn('model', 'text')
    .addColumn('permission_mode', 'text')
    .addColumn('status', 'text', c => c.notNull().defaultTo('idle')) // running | waiting | idle | ended
    .addColumn('last_event', 'text')
    .addColumn('last_tool', 'text')
    .addColumn('last_prompt', 'text')
    .addColumn('last_message', 'text')
    .addColumn('prompt_count', 'integer', c => c.notNull().defaultTo(0))
    .addColumn('tool_count', 'integer', c => c.notNull().defaultTo(0))
    .addColumn('input_tokens', 'bigint')
    .addColumn('output_tokens', 'bigint')
    .addColumn('cache_read_tokens', 'bigint')
    .addColumn('cache_creation_tokens', 'bigint')
    .addColumn('context_tokens', 'bigint')
    .addColumn('usage_updated_at', 'timestamptz')
    .addColumn('started_at', 'timestamptz', c => c.notNull().defaultTo(sql`now()`))
    .addColumn('last_event_at', 'timestamptz', c => c.notNull().defaultTo(sql`now()`))
    .addColumn('ended_at', 'timestamptz')
    .addColumn('end_reason', 'text')
    .addUniqueConstraint('agent_sessions_agent_session_uq', ['agent_id', 'session_id'])
    .execute();
  await db.schema.createIndex('agent_sessions_status_idx').on('agent_sessions').columns(['status', 'last_event_at']).execute();

  await db.schema
    .createTable('agent_events')
    .addColumn('id', 'bigserial', c => c.primaryKey())
    .addColumn('agent_session_id', 'uuid', c => c.notNull().references('agent_sessions.id').onDelete('cascade'))
    .addColumn('event', 'text', c => c.notNull())
    .addColumn('tool_name', 'text')
    .addColumn('detail', 'jsonb', c => c.notNull().defaultTo(sql`'{}'::jsonb`))
    .addColumn('correlation_id', 'text')
    .addColumn('received_at', 'timestamptz', c => c.notNull().defaultTo(sql`now()`))
    .execute();
  await db.schema.createIndex('agent_events_session_idx').on('agent_events').columns(['agent_session_id', 'received_at']).execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('agent_events').execute();
  await db.schema.dropTable('agent_sessions').execute();
  await db.schema.dropTable('agents').execute();
}
