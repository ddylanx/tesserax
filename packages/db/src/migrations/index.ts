import type { Migration } from 'kysely';
import * as m001 from './001_init';
import * as m002 from './002_agents';

/** Ordered list of migrations. Add new files here; names sort lexically. */
export const migrations: Record<string, Migration> = {
  '001_init': m001,
  '002_agents': m002,
};
