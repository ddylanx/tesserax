import { Controller, Get, Inject } from '@nestjs/common';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { sql } from 'kysely';
import type { AppConfig } from '@tesserax/config';
import { jiraConfigured } from '@tesserax/config';
import type { AgentCliStatus, EnvironmentStatus, Health, SystemInfo } from '@tesserax/contracts';
import { CONFIG, DB, QUEUE, SCHEDULES, type Queue, type ScheduleRegistry } from '@tesserax/core';
import type { Db } from '@tesserax/db';

export interface EnvironmentDetectorDeps {
  path?: string;
  home?: string;
  onPath?: (bin: string, pathEnv: string) => boolean;
  fileExists?: (path: string) => boolean;
}

export function defaultOnPath(bin: string, pathEnv = process.env.PATH ?? ''): boolean {
  if (!pathEnv) return false;
  for (const part of pathEnv.split(':')) {
    if (!part) continue;
    try {
      const full = join(part, bin);
      if (existsSync(full)) return true;
    } catch {
      // ignore
    }
  }
  return false;
}

export function detectEnvironment(
  postgresStatus: 'ok' | 'down',
  deps: EnvironmentDetectorDeps = {},
): EnvironmentStatus {
  const pathEnv = deps.path ?? process.env.PATH ?? '';
  const home = deps.home ?? homedir();
  const onPath = deps.onPath ?? ((b: string) => defaultOnPath(b, pathEnv));
  const fileExists = deps.fileExists ?? existsSync;

  const git = onPath('git', pathEnv) || fileExists('/usr/bin/git');

  const checkAgent = (
    id: 'claude' | 'gemini' | 'antigravity',
    name: string,
    bin: string,
    credFiles: string[],
    signInCommand: string,
  ): AgentCliStatus => {
    const installed = onPath(bin, pathEnv) || fileExists(bin);
    let signedIn: 'yes' | 'no' | 'unknown' = 'no';
    if (installed) {
      const hasCreds = credFiles.some(f => fileExists(f));
      signedIn = hasCreds ? 'yes' : 'unknown';
    }
    return { id, name, installed, signedIn, signInCommand };
  };

  const agents: AgentCliStatus[] = [
    checkAgent('claude', 'Claude Code', 'claude', [join(home, '.claude.json'), join(home, '.claude')], 'claude'),
    checkAgent('gemini', 'Gemini CLI', 'gemini', [join(home, '.gemini')], 'gemini'),
    checkAgent('antigravity', 'Antigravity CLI', 'agy', [join(home, '.gemini', 'antigravity-cli'), join(home, '.antigravity')], 'agy'),
  ];

  const ready = postgresStatus === 'ok' && git && agents.some(a => a.installed);

  return {
    postgres: postgresStatus,
    git,
    agents,
    ready,
  };
}

@Controller()
export class SystemController {
  constructor(
    @Inject(CONFIG) private readonly config: AppConfig,
    @Inject(DB) private readonly db: Db,
    @Inject(QUEUE) private readonly queue: Queue,
    @Inject(SCHEDULES) private readonly schedules: ScheduleRegistry,
  ) {}

  @Get('health')
  async health(): Promise<Health> {
    const db = await sql`select 1`.execute(this.db).then(() => 'ok' as const, () => 'down' as const);
    const queue = await this.queue.boss.getQueues().then(() => 'ok' as const, () => 'down' as const);
    return {
      status: db === 'ok' && queue === 'ok' ? 'ok' : 'degraded',
      db,
      queue,
      uptimeSeconds: Math.round(process.uptime()),
      time: new Date().toISOString(),
    };
  }

  @Get('system/environment')
  async environment(): Promise<EnvironmentStatus> {
    const db = await sql`select 1`.execute(this.db).then(() => 'ok' as const, () => 'down' as const);
    return detectEnvironment(db);
  }

  @Get('system')
  async system(): Promise<SystemInfo> {
    const health = await this.health();
    return {
      health,
      schedules: this.schedules.list(),
      integrations: [
        { name: 'Jira Cloud', configured: jiraConfigured(this.config), note: 'JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN' },
        { name: 'Telegram bot', configured: Boolean(this.config.TELEGRAM_BOT_TOKEN), note: 'TELEGRAM_BOT_TOKEN, TELEGRAM_ALLOWED_USER_IDS' },
      ],
      environment: detectEnvironment(health.db),
    };
  }
}

