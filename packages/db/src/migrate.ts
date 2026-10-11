import { Migrator, type MigrationResultSet } from 'kysely';
import type { Db } from './client';
import { migrations } from './migrations';

export async function migrateToLatest(db: Db): Promise<MigrationResultSet> {
  const migrator = new Migrator({ db, provider: { getMigrations: async () => migrations } });
  const result = await migrator.migrateToLatest();
  if (result.error) throw result.error;
  return result;
}
