import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import type { Database } from './schema';

export type Db = Kysely<Database>;

export function createDb(connectionString: string): Db {
  const pool = new Pool({ connectionString, max: 10, keepAlive: true });
  // An idle connection the server dropped (Postgres restart, Docker pause, sleep) emits 'error' on the pool;
  // unhandled, that crashes the whole API. The pool discards the client and opens a new one on the next query.
  pool.on('error', err => console.warn(`[db] idle connection dropped: ${err.message}`));
  return new Kysely<Database>({ dialect: new PostgresDialect({ pool }) });
}
