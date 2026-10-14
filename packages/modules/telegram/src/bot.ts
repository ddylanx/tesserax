import { Bot, type Context } from 'grammy';
import type { UserFromGetMe } from 'grammy/types';
import type { AgentSessionList, McpList, TaskList } from '@tesserax/contracts';
import { WorkContext, createLogger } from '@tesserax/core';
import { formatAgents, formatMcp, formatTasks } from './format';

const log = createLogger('telegram');

export interface BotDeps {
  tasks: () => Promise<TaskList>;
  agents: () => Promise<AgentSessionList>;
  mcp: () => Promise<McpList>;
}

export const HELP = [
  '<b>Tesserax</b> (read-only)',
  '/tasks open Jira tasks',
  '/agents Claude Code sessions',
  '/mcp enabled MCP servers',
].join('\n');

/** Builds the bot; the caller starts it (long polling) or feeds updates in tests. */
export function createBot(token: string, allowedUserIds: number[], deps: BotDeps, botInfo?: UserFromGetMe): Bot {
  const bot = new Bot(token, botInfo ? { botInfo } : undefined);
  const allowed = new Set(allowedUserIds);

  // One WorkContext per update, so logs of a command share a correlationId.
  bot.use((ctx, next) => WorkContext.run({ origin: `telegram:${ctx.update.update_id}` }, next));

  bot.use(async (ctx, next) => {
    const id = ctx.from?.id;
    if (id !== undefined && allowed.has(id)) return next();
    log.warn({ userId: id }, 'telegram user not in TELEGRAM_ALLOWED_USER_IDS');
    if (ctx.chat?.type === 'private' && id !== undefined) {
      await ctx.reply(`Not allowed. To allow yourself, add ${id} to TELEGRAM_ALLOWED_USER_IDS in .env and restart.`);
    }
  });

  const html = (ctx: Context, text: string) => ctx.reply(text, { parse_mode: 'HTML', link_preview_options: { is_disabled: true } });

  bot.command(['start', 'help'], ctx => html(ctx, HELP));
  bot.command('tasks', async ctx => html(ctx, formatTasks(await deps.tasks())));
  bot.command('agents', async ctx => html(ctx, formatAgents(await deps.agents())));
  bot.command('mcp', async ctx => html(ctx, formatMcp(await deps.mcp())));
  bot.on('message', ctx => html(ctx, HELP));

  bot.catch(err => log.error({ err: err.error }, `telegram update ${err.ctx.update.update_id} failed`));
  return bot;
}
