import { Inject, Module, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import type { Bot } from 'grammy';
import type { AppConfig } from '@ot/config';
import { CONFIG, createLogger } from '@ot/core';
import { AgentsModule, AgentsService } from '@ot/mod-agents';
import { McpModule, McpService } from '@ot/mod-mcp';
import { TasksModule, TasksService } from '@ot/mod-tasks';
import { HELP, createBot } from './bot';

const log = createLogger('telegram');

/** Read-only Telegram bot over long polling (no public URL needed). Off when TELEGRAM_BOT_TOKEN is empty. */
@Module({ imports: [TasksModule, AgentsModule, McpModule] })
export class TelegramModule implements OnApplicationBootstrap, OnApplicationShutdown {
  private bot?: Bot;

  constructor(
    @Inject(CONFIG) private readonly config: AppConfig,
    private readonly tasks: TasksService,
    private readonly agents: AgentsService,
    private readonly mcp: McpService,
  ) {}

  async onApplicationBootstrap() {
    const token = this.config.TELEGRAM_BOT_TOKEN;
    if (!token) {
      log.info('Telegram bot off (TELEGRAM_BOT_TOKEN not set)');
      return;
    }
    const allowed = this.config.TELEGRAM_ALLOWED_USER_IDS;
    if (allowed.length === 0) log.warn('TELEGRAM_ALLOWED_USER_IDS is empty: the bot will answer nobody except with their user id');
    this.bot = createBot(token, allowed, {
      tasks: () => this.tasks.list({}),
      agents: () => this.agents.listSessions('active'),
      mcp: () => this.mcp.list(),
    });
    await this.bot.api.setMyCommands([
      { command: 'tasks', description: 'Open Jira tasks' },
      { command: 'agents', description: 'Claude Code sessions' },
      { command: 'mcp', description: 'Enabled MCP servers' },
      { command: 'help', description: HELP.split('\n')[0]!.replace(/<[^>]+>/g, '') },
    ]).catch(err => log.warn({ err }, 'setMyCommands failed'));
    // Long polling; not awaited (resolves only when the bot stops).
    void this.bot
      .start({ drop_pending_updates: true, onStart: me => log.info(`Telegram bot @${me.username} polling`) })
      .catch(err => log.error({ err }, 'Telegram bot stopped with an error (check TELEGRAM_BOT_TOKEN)'));
  }

  async onApplicationShutdown() {
    await this.bot?.stop().catch(() => undefined);
  }
}
