import { Inject, Injectable } from '@nestjs/common';
import { DB } from '@ot/core';
import type { Db } from '@ot/db';

@Injectable()
export class ArtifactService {
  constructor(@Inject(DB) private readonly db: Db) {}

  async saveArtifact(runId: string, nodeRunId: string | null, name: string, content: string, author: 'ai' | 'user') {
    const latest = await this.latestArtifact(runId, name);
    await this.db
      .insertInto('artifacts')
      .values({ run_id: runId, node_run_id: nodeRunId, name, version: (latest?.version ?? 0) + 1, author, content })
      .execute();
  }

  async latestArtifact(runId: string, name: string) {
    return this.db
      .selectFrom('artifacts')
      .selectAll()
      .where('run_id', '=', runId)
      .where('name', '=', name)
      .orderBy('version', 'desc')
      .executeTakeFirst();
  }

  async latestArtifacts(runId: string): Promise<Record<string, string>> {
    const rows = await this.db
      .selectFrom('artifacts')
      .select(['name', 'content'])
      .distinctOn('name')
      .where('run_id', '=', runId)
      .orderBy('name')
      .orderBy('version', 'desc')
      .execute();
    return Object.fromEntries(rows.map(r => [r.name, r.content]));
  }
}
