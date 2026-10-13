import { Inject, Module, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import type { Bot } from 'grammy';
import type { AppConfig } from '@ot/config';
import { CONFIG, createLogger } from '@ot/core';
import { AgentsModule, AgentsService } from '@ot/mod-agents';
import { McpModule, McpService } from '@ot/mod-mcp';
import { PipelineModule, PipelineService } from '@ot/mod-pipeline';
import { TasksModule, TasksService } from '@ot/mod-tasks';
import { WorkflowEngine, WorkflowModule } from '@ot/mod-workflow';
import { HELP, createBot } from './bot';
import { formatPipelineNotice, formatWorkflowNotice } from './format';

const log = createLogger('telegram');

/** Read-only Telegram bot over long polling (no public URL needed). Off when TELEGRAM_BOT_TOKEN is empty. */
@Module({ imports: [TasksModule, AgentsModule, McpModule, PipelineModule, WorkflowModule] })
export class TelegramModule implements OnApplicationBootstrap, OnApplicationShutdown {
  private bot?: Bot;

  constructor(
    @Inject(CONFIG) private readonly config: AppConfig,
    private readonly tasks: TasksService,
    private readonly agents: AgentsService,
    private readonly mcp: McpService,
    private readonly pipeline: PipelineService,
    private readonly workflow: WorkflowEngine,
  ) {}

  private async notify(text: string) {
    if (!this.bot) return;
    for (const userId of this.config.TELEGRAM_ALLOWED_USER_IDS) {
      await this.bot.api
        .sendMessage(userId, text, { parse_mode: 'HTML', link_preview_options: { is_disabled: true } })
        .catch(err => log.warn({ err: (err as Error).message, userId }, 'telegram notify failed'));
    }
  }

  /** Notifications only (no actions from Telegram yet): classification ready, awaiting verify, failed. */
  private subscribePipeline() {
    this.pipeline.onTransition(async (run, _from, to) => {
      const text = formatPipelineNotice(run, to, this.config.WEB_BASE_URL);
      if (text) await this.notify(text);
    });
  }

  /** Workflow runs: waiting for a person, failed, done. */
  private subscribeWorkflow() {
    this.workflow.onRunEvent(async (run, event) => {
      await this.notify(formatWorkflowNotice(run, event, this.config.WEB_BASE_URL));
    });
  }

  async onApplicationBootstrap() {
    const token = this.config.TELEGRAM_BOT_TOKEN;
    if (!token) {
      log.info('Telegram bot off (TELEGRAM_BOT_TOKEN not set)');
      return;
    }
    const allowed = this.config.TELEGRAM_ALLOWED_USER_IDS;
    if (allowed.length === 0) log.warn('TELEGRAM_ALLOWED_USER_IDS is empty: the bot will answer nobody except with their user id');
    this.subscribePipeline();
    this.subscribeWorkflow();
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
