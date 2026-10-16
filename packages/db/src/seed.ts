import type { Db } from './client';

export const SEED_PROJECTS = [
  { slug: 'personal', name: 'Personal', kind: 'personal', color: '#16a34a', position: 1 },
  { slug: 'company', name: 'Company', kind: 'company', color: '#2563eb', position: 2 },
] as const;

/** Idempotent: safe to run on every start. Keeps exactly one default project (company, receives tasks no rule matches). */
export async function seed(db: Db): Promise<void> {
  await db
    .insertInto('projects')
    .values(SEED_PROJECTS.map(p => ({ ...p })))
    .onConflict(oc => oc.column('slug').doNothing())
    .execute();
  const hasDefault = await db.selectFrom('projects').select('id').where('is_default', '=', true).executeTakeFirst();
  if (!hasDefault) {
    const first = await db.selectFrom('projects').select('id').orderBy('position').orderBy('created_at').executeTakeFirst();
    const company = await db.selectFrom('projects').select('id').where('slug', '=', 'company').executeTakeFirst();
    const pick = company ?? first;
    if (pick) await db.updateTable('projects').set({ is_default: true }).where('id', '=', pick.id).execute();
  }
}
