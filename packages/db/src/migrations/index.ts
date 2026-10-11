import type { Migration } from 'kysely';
import * as m001 from './001_init';

/** Ordered list of migrations. Add new files here; names sort lexically. */
export const migrations: Record<string, Migration> = {
  '001_init': m001,
};
