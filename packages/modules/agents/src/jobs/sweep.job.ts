import { sql } from 'kysely';
import type { Db } from '@tesserax/db';
import { createLogger } from '@tesserax/core';

export const SWEEP_JOB = 'agents.sweep';
const log = createLogger('agents.sweep');

/** Ends sessions that went silent (Claude Code killed without SessionEnd) and prunes old events. */
export async function runSweepJob(db: Db): Promise<void> {
  const ended = await db
    .updateTable('agent_sessions')
    .set({ status: 'ended', ended_at: sql`now()`, end_reason: 'stale' })
    .where('status', '!=', 'ended')
    .where('last_event_at', '<', sql<Date>`now() - interval '12 hours'`)
    .executeTakeFirst();
  const pruned = await db.deleteFrom('agent_events').where('received_at', '<', sql<Date>`now() - interval '14 days'`).executeTakeFirst();
  const n = Number(ended.numUpdatedRows), p = Number(pruned.numDeletedRows);
  if (n || p) log.info({ endedStale: n, prunedEvents: p }, 'sweep');
}
