import { type Kysely } from 'kysely';

/** Tasks created in Open Tesseract (not from Jira) and, for code reviews, which PR/branches to review. */
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('tasks')
    .addColumn('review', 'jsonb') // { sourceBranch, targetBranch?, prUrl? }
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.alterTable('tasks').dropColumn('review').execute();
}
