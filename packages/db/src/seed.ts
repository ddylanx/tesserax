import type { Db } from './client';

export const SEED_WORKSPACES = [
  { slug: 'personal', name: 'Personal', kind: 'personal' },
  { slug: 'company', name: 'Company', kind: 'company' },
] as const;

/** Idempotent: safe to run on every start. */
export async function seed(db: Db): Promise<void> {
  await db
    .insertInto('workspaces')
    .values(SEED_WORKSPACES.map(w => ({ ...w })))
    .onConflict(oc => oc.column('slug').doNothing())
    .execute();
}
