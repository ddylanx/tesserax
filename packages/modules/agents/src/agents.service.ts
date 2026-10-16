import { hostname } from 'node:os';
import { basename } from 'node:path';
import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import type { AgentEventDto, AgentSessionDto, AgentSessionList, ClaudeHookPayload, ProjectDirectory } from '@tesserax/contracts';
import { DB, PROJECT_DIRECTORY, QUEUE, WorkContext, type Queue } from '@tesserax/core';
import type { AgentSession, AgentSessionUpdate, Db } from '@tesserax/db';
import { readBranch } from './git';
import { STORED_EVENTS, USAGE_EVENTS, detailFor, modelName, statusFor } from './hook-mapping';
import { USAGE_JOB, type UsageJobData } from './jobs/usage.job';

/** A session not ended but silent for this long is shown as stale. */
export const STALE_AFTER_MS = 2 * 60 * 60 * 1000;

const num = (v: string | number | null) => (v == null ? 0 : Number(v));

@Injectable()
export class AgentsService {
  private agentIds = new Map<string, string>();

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(QUEUE) private readonly queue: Queue,
    @Inject(PROJECT_DIRECTORY) private readonly projects: ProjectDirectory,
  ) {}

  private projectCache = new Map<string, { id: string | null; at: number }>();

  /** The project a folder belongs to; hooks fire many times a minute, so answers are kept for 30 s. */
  private async projectIdFor(cwd: string): Promise<string | null> {
    const hit = this.projectCache.get(cwd);
    if (hit && Date.now() - hit.at < 30_000) return hit.id;
    const id = (await this.projects.resolveForPath(cwd).catch(() => null))?.id ?? null;
    this.projectCache.set(cwd, { id, at: Date.now() });
    return id;
  }

  private async agentId(kind: string, host: string): Promise<string> {
    const key = `${kind}|${host}`;
    const cached = this.agentIds.get(key);
    if (cached) return cached;
    const row = await this.db
      .insertInto('agents')
      .values({ kind, host, name: `${kind === 'claude-code' ? 'Claude Code' : kind} @ ${host}` })
      .onConflict(oc => oc.columns(['kind', 'host']).doUpdateSet({ last_seen_at: sql`now()` }))
      .returning('id')
      .executeTakeFirstOrThrow();
    this.agentIds.set(key, row.id);
    return row.id;
  }

  /** Ingests one Claude Code hook event. */
  async ingestClaudeHook(p: ClaudeHookPayload, host = hostname()): Promise<{ sessionId: string; status: string }> {
    const agentId = await this.agentId('claude-code', host);
    const event = p.hook_event_name;
    const status = statusFor(p);
    const now = new Date();

    const update: AgentSessionUpdate = { last_event: event, last_event_at: now };
    if (status) update.status = status;
    if (p.cwd) {
      update.cwd = p.cwd;
      update.branch = readBranch(p.cwd);
      update.project_id = await this.projectIdFor(p.cwd);
    }
    if (p.transcript_path) update.transcript_path = p.transcript_path;
    if (p.permission_mode) update.permission_mode = p.permission_mode;
    const model = modelName(p.model);
    if (model) update.model = model;
    if (event === 'PreToolUse' || event === 'PostToolUse') update.last_tool = p.tool_name ?? null;
    if (event === 'UserPromptSubmit') {
      update.last_prompt = (p.prompt ?? '').slice(0, 300);
      update.last_message = null;
    }
    if (event === 'Notification') update.last_message = (p.message ?? '').slice(0, 300);
    if (event === 'Stop') update.last_message = null;
    if (event === 'SessionEnd') {
      update.ended_at = now;
      update.end_reason = p.reason ?? null;
    }
    if (event === 'SessionStart') {
      update.ended_at = null;
      update.end_reason = null;
    }

    const row = await this.db
      .insertInto('agent_sessions')
      .values({ agent_id: agentId, session_id: p.session_id, ...update, status: update.status ?? 'idle' } as never)
      .onConflict(oc =>
        oc.columns(['agent_id', 'session_id']).doUpdateSet({
          ...update,
          prompt_count: event === 'UserPromptSubmit' ? sql`agent_sessions.prompt_count + 1` : sql`agent_sessions.prompt_count`,
          tool_count: event === 'PostToolUse' ? sql`agent_sessions.tool_count + 1` : sql`agent_sessions.tool_count`,
        } as never),
      )
      .returning(['id', 'status'])
      .executeTakeFirstOrThrow();

    if (STORED_EVENTS(event)) {
      await this.db
        .insertInto('agent_events')
        .values({
          agent_session_id: row.id,
          event,
          tool_name: p.tool_name ?? null,
          detail: JSON.stringify(detailFor(p)),
          correlation_id: WorkContext.correlationId() ?? null,
        })
        .execute();
    }

    if (p.transcript_path && USAGE_EVENTS.has(event)) {
      const data: UsageJobData = { agentSessionId: row.id };
      // At most one transcript read per session every 15 s; the last event in a burst still gets one.
      await this.queue.sendDebounced(USAGE_JOB, data, 15, row.id);
    }
    return { sessionId: row.id, status: row.status };
  }

  /** `project` is a project slug: only sessions in that project. */
  async listSessions(scope: 'active' | 'all' = 'active', project?: string, limit = 200): Promise<AgentSessionList> {
    let q = this.db
      .selectFrom('agent_sessions as s')
      .innerJoin('agents as a', 'a.id', 's.agent_id')
      .leftJoin('projects as p', 'p.id', 's.project_id')
      .selectAll('s')
      .select(['a.kind as agent_kind', 'a.host as agent_host', 'p.slug as project_slug', 'p.color as project_color'])
      .orderBy('s.last_event_at', 'desc')
      .limit(limit);
    if (scope === 'active') q = q.where('s.status', '!=', 'ended');
    if (project) q = q.where('p.slug', '=', project);
    const rows = await q.execute();
    const counts = await this.db
      .selectFrom('agent_sessions')
      .select(['status', sql<number>`count(*)::int`.as('n')])
      .groupBy('status')
      .execute();
    const last = await this.db.selectFrom('agent_events').select(sql<Date | null>`max(received_at)`.as('at')).executeTakeFirst();
    return {
      sessions: rows.map(r => this.toDto(r, r.agent_kind, r.agent_host, r.project_slug, r.project_color)),
      counts: Object.fromEntries(counts.map(c => [c.status, c.n])),
      lastEventAt: last?.at ? new Date(last.at).toISOString() : null,
    };
  }

  async listEvents(agentSessionId: string, limit = 100): Promise<AgentEventDto[]> {
    const rows = await this.db
      .selectFrom('agent_events')
      .select(['id', 'event', 'tool_name', 'detail', 'received_at'])
      .where('agent_session_id', '=', agentSessionId)
      .orderBy('id', 'desc')
      .limit(limit)
      .execute();
    return rows.map(r => ({
      id: String(r.id),
      event: r.event,
      toolName: r.tool_name,
      detail: (r.detail ?? {}) as Record<string, unknown>,
      receivedAt: r.received_at.toISOString(),
    }));
  }

  toDto(r: AgentSession, kind: string, host: string, projectSlug: string | null = null, projectColor: string | null = null): AgentSessionDto {
    const lastEventAt = new Date(r.last_event_at);
    return {
      id: r.id,
      agentKind: kind,
      host,
      sessionId: r.session_id,
      cwd: r.cwd,
      project: r.cwd ? basename(r.cwd) : null,
      projectSlug,
      projectColor,
      branch: r.branch,
      model: r.model,
      permissionMode: r.permission_mode,
      status: r.status,
      stale: r.status !== 'ended' && Date.now() - lastEventAt.getTime() > STALE_AFTER_MS,
      lastEvent: r.last_event,
      lastTool: r.last_tool,
      lastPrompt: r.last_prompt,
      lastMessage: r.last_message,
      promptCount: r.prompt_count,
      toolCount: r.tool_count,
      usage: r.usage_updated_at
        ? {
            inputTokens: num(r.input_tokens),
            outputTokens: num(r.output_tokens),
            cacheReadTokens: num(r.cache_read_tokens),
            cacheCreationTokens: num(r.cache_creation_tokens),
            contextTokens: r.context_tokens == null ? null : num(r.context_tokens),
            updatedAt: new Date(r.usage_updated_at).toISOString(),
          }
        : null,
      startedAt: new Date(r.started_at).toISOString(),
      lastEventAt: lastEventAt.toISOString(),
      endedAt: r.ended_at ? new Date(r.ended_at).toISOString() : null,
      endReason: r.end_reason,
    };
  }
}
