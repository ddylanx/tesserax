import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { createBot } from './bot';

const botInfo = { id: 1, is_bot: true as const, first_name: 'ot', username: 'ot_bot', can_join_groups: false, can_read_all_group_messages: false, supports_inline_queries: false, can_connect_to_business: false, has_main_web_app: false };

function setup(allowed: number[]) {
  const sent: { method: string; text?: string }[] = [];
  const bot = createBot('123:abc', allowed, {
    tasks: async () => ({ jiraConfigured: true, boards: [], sources: [], tasks: [{ id: '1', projectSlug: 'company', source: 'jira', key: 'PAY-1', title: 'Fix <b>', status: 'In Progress', statusCategory: 'in_progress', priority: null, assignee: null, project: 'PAY', type: null, labels: [], url: 'https://x/browse/PAY-1', dueAt: null, updatedAt: null, archived: false }] }),
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

test('pipeline notices: decision, verify, failed; nothing for other states', async () => {
  const { formatPipelineNotice } = await import('./format');
  const run = {
    id: 'r1', state: 'awaiting_decision', trigger: 'manual', attempt: 1,
    task: { id: 't', projectSlug: 'company', source: 'jira', key: 'DEMO-1', title: 'Login <broken>', status: null, statusCategory: 'todo', priority: null, assignee: null, project: 'DEMO', type: 'Bug', labels: [], url: null, dueAt: null, updatedAt: null, archived: false },
    classification: { type: 'bug', automation: 'assisted', playbook: 'investigate-bug', repo: null, confidence: 0.82, reasoning: '' },
    classificationEngine: 'claude-cli', decision: null, playbookId: 'fix-bug', repoPath: null, branch: 'tx/DEMO-1', worktreePath: null,
    agentSessionId: null, result: { exitCode: 0, isError: false, subtype: 'success', summary: '', durationMs: 1, costUsd: 0, numTurns: 1, diff: { files: 2, insertions: 3, deletions: 1, stat: '', untracked: [] }, commits: ['abc x'], signal: 'ok' },
    error: 'quota: limit', errorStep: 'run', verifyNote: null, jiraCommentId: null, createdAt: '', stateChangedAt: '',
  } as never;
  const d = formatPipelineNotice(run, 'awaiting_decision', 'http://127.0.0.1:5180/')!;
  assert.match(d, /DEMO-1.*needs your decision/);
  assert.match(d, /Login &lt;broken&gt;/);
  assert.match(d, /inbox\?run=r1/);
  assert.match(formatPipelineNotice(run, 'awaiting_verify', 'http://x')!, /2 files, \+3 −1, 1 commits on tx\/DEMO-1/);
  assert.match(formatPipelineNotice(run, 'failed', 'http://x')!, /failed at run/);
  assert.equal(formatPipelineNotice(run, 'queued', 'http://x'), null);
});

test('workflow notices: waiting, failed, done link to the run page', async () => {
  const { formatWorkflowNotice } = await import('./format');
  const run = {
    id: 'w1', status: 'waiting', workflowId: 'fix-bug', workflowHash: 'h', trigger: 'manual',
    task: { id: 't', projectSlug: 'company', source: 'jira', key: 'DEMO-2', title: 'Pay <fails>', status: null, statusCategory: 'todo', priority: null, assignee: null, project: 'DEMO', type: 'Bug', labels: [], url: null, dueAt: null, updatedAt: null, archived: false },
    currentNodeId: 'review', currentNodeLabel: 'Review plan', repoPath: null, baseRef: null, branch: null, worktreePath: null,
    error: 'quota: limit', costUsd: 0, vars: {}, createdAt: '', updatedAt: '', finishedAt: null,
  } as never;
  const w = formatWorkflowNotice(run, 'waiting', 'http://127.0.0.1:5180/');
  assert.match(w, /DEMO-2.*waiting for you at Review plan/);
  assert.match(w, /Pay &lt;fails&gt;/);
  assert.match(w, /\/runs\/w1/);
  assert.match(formatWorkflowNotice(run, 'failed', 'http://x'), /workflow failed[\s\S]*quota: limit/);
  assert.match(formatWorkflowNotice(run, 'done', 'http://x'), /workflow done/);
});

