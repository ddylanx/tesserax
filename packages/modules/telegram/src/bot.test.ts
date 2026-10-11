import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { createBot } from './bot';

const botInfo = { id: 1, is_bot: true as const, first_name: 'ot', username: 'ot_bot', can_join_groups: false, can_read_all_group_messages: false, supports_inline_queries: false, can_connect_to_business: false, has_main_web_app: false };

function setup(allowed: number[]) {
  const sent: { method: string; text?: string }[] = [];
  const bot = createBot('123:abc', allowed, {
    tasks: async () => ({ jiraConfigured: true, projects: [], sources: [], tasks: [{ id: '1', workspace: 'company', source: 'jira', key: 'PAY-1', title: 'Fix <b>', status: 'In Progress', statusCategory: 'in_progress', priority: null, assignee: null, project: 'PAY', type: null, labels: [], url: 'https://x/browse/PAY-1', dueAt: null, updatedAt: null, archived: false }] }),
    agents: async () => ({ sessions: [], counts: {}, lastEventAt: null }),
    mcp: async () => ({ provider: 't', generatedAt: '', servers: [{ id: 'a', name: 'github', client: 'Claude Code', scope: 'user', file: '', transport: 'http', target: '', enabled: true, envKeys: [] }] }),
  }, botInfo as never);
  bot.api.config.use(async (_prev, method, payload) => {
    sent.push({ method, text: (payload as { text?: string }).text });
    return { ok: true, result: { message_id: 1, date: 0, chat: { id: 1, type: 'private' } } } as never;
  });
  const msg = (from: number, text: string) => bot.handleUpdate({
    update_id: Math.floor(Math.random() * 1e6),
    message: { message_id: 1, date: 0, chat: { id: from, type: 'private', first_name: 'u' }, from: { id: from, is_bot: false, first_name: 'u' }, text, entities: text.startsWith('/') ? [{ type: 'bot_command', offset: 0, length: text.split(' ')[0]!.length }] : [] },
  } as never);
  return { sent, msg };
}

test('allowed user gets /tasks, HTML escaped', async () => {
  const { sent, msg } = setup([42]);
  await msg(42, '/tasks');
  assert.equal(sent.length, 1);
  assert.match(sent[0]!.text!, /PAY-1<\/a> Fix &lt;b&gt;/);
});

test('/mcp lists enabled servers', async () => {
  const { sent, msg } = setup([42]);
  await msg(42, '/mcp');
  assert.match(sent[0]!.text!, /github/);
});

test('unknown user is refused and told their id', async () => {
  const { sent, msg } = setup([42]);
  await msg(7, '/tasks');
  assert.equal(sent.length, 1);
  assert.match(sent[0]!.text!, /Not allowed.*\b7\b/);
});
