import { Controller, Get, Inject } from '@nestjs/common';
import { sql } from 'kysely';
import type { AppConfig } from '@tesserax/config';
import { jiraConfigured } from '@tesserax/config';
import type { Health, SystemInfo } from '@tesserax/contracts';
import { CONFIG, DB, QUEUE, SCHEDULES, type Queue, type ScheduleRegistry } from '@tesserax/core';
import type { Db } from '@tesserax/db';

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

  @Get('system')
  async system(): Promise<SystemInfo> {
    const workspaces = await this.db.selectFrom('workspaces').select(['id', 'slug', 'name', 'kind']).orderBy('created_at').execute();
    return {
      health: await this.health(),
      workspaces,
      schedules: this.schedules.list(),
      integrations: [
        { name: 'Jira Cloud', configured: jiraConfigured(this.config), note: 'JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN' },
        { name: 'Telegram bot', configured: Boolean(this.config.TELEGRAM_BOT_TOKEN), note: 'TELEGRAM_BOT_TOKEN, TELEGRAM_ALLOWED_USER_IDS' },
      ],
    };
  }
}
