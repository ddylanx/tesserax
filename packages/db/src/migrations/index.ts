import type { Migration } from 'kysely';
import * as m001 from './001_init';
import * as m002 from './002_agents';
import * as m003 from './003_tasks';
import * as m004 from './004_task_detail';
import * as m005 from './005_pipeline';
import * as m006 from './006_pipeline_feedback';

/** Ordered list of migrations. Add new files here; names sort lexically. */
export const migrations: Record<string, Migration> = {
  '001_init': m001,
  '002_agents': m002,
  '003_tasks': m003,
  '004_task_detail': m004,
  '005_pipeline': m005,
  '006_pipeline_feedback': m006,
};
