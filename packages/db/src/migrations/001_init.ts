import { type Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await sql`create extension if not exists pgcrypto`.execute(db);

  await db.schema
    .createTable('workspaces')
    .addColumn('id', 'uuid', c => c.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('slug', 'text', c => c.notNull().unique())
    .addColumn('name', 'text', c => c.notNull())
    .addColumn('kind', 'text', c => c.notNull().check(sql`kind in ('personal', 'company')`))
    .addColumn('created_at', 'timestamptz', c => c.notNull().defaultTo(sql`now()`))
    .execute();

  await db.schema
    .createTable('sources')
    .addColumn('id', 'uuid', c => c.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('workspace_id', 'uuid', c => c.notNull().references('workspaces.id').onDelete('cascade'))
    .addColumn('kind', 'text', c => c.notNull())
    .addColumn('name', 'text', c => c.notNull())
    .addColumn('config', 'jsonb', c => c.notNull().defaultTo(sql`'{}'::jsonb`))
    .addColumn('last_synced_at', 'timestamptz')
    .addColumn('last_error', 'text')
    .addColumn('created_at', 'timestamptz', c => c.notNull().defaultTo(sql`now()`))
    .addUniqueConstraint('sources_workspace_kind_name_uq', ['workspace_id', 'kind', 'name'])
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('sources').execute();
  await db.schema.dropTable('workspaces').execute();
}
