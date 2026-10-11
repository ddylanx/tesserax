import { loadConfig } from '@ot/config';
import { createDb } from './client';
import { migrateToLatest } from './migrate';
import { seed } from './seed';

async function main() {
  const cmd = process.argv[2];
  const db = createDb(loadConfig().DATABASE_URL);
  try {
    if (cmd === 'migrate') {
      const { results } = await migrateToLatest(db);
      for (const r of results ?? []) console.log(`${r.status}: ${r.migrationName}`);
      if (!results?.length) console.log('already up to date');
    } else if (cmd === 'seed') {
      await seed(db);
      console.log('seeded');
    } else {
      console.error('usage: cli.ts migrate|seed');
      process.exitCode = 1;
    }
  } finally {
    await db.destroy();
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
