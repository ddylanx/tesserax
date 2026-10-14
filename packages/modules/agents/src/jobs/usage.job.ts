import type { Db } from '@tesserax/db';
import { createLogger } from '@tesserax/core';
import { readTranscriptUsage } from '../transcript-usage';

export const USAGE_JOB = 'agents.usage';
export interface UsageJobData {
  agentSessionId: string;
}

const log = createLogger('agents.usage');

/** Reads token usage from the session's transcript (same machine in local mode) and stores the totals. */
export async function runUsageJob(db: Db, { agentSessionId }: UsageJobData): Promise<void> {
  const s = await db.selectFrom('agent_sessions').select(['transcript_path', 'model']).where('id', '=', agentSessionId).executeTakeFirst();
  if (!s?.transcript_path) return;
  const usage = await readTranscriptUsage(s.transcript_path);
  if (!usage) return;
  await db
    .updateTable('agent_sessions')
    .set({
      input_tokens: usage.inputTokens,
      output_tokens: usage.outputTokens,
      cache_read_tokens: usage.cacheReadTokens,
      cache_creation_tokens: usage.cacheCreationTokens,
      context_tokens: usage.contextTokens,
      model: usage.model ?? s.model,
      usage_updated_at: new Date(),
    })
    .where('id', '=', agentSessionId)
    .execute();
  log.debug({ agentSessionId, out: usage.outputTokens }, 'usage updated');
}
