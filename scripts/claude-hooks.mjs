#!/usr/bin/env node
// Claude Code hooks that report sessions to the local Tesserax API.
//
//   node scripts/claude-hooks.mjs print                       show the settings snippet (changes nothing)
//   node scripts/claude-hooks.mjs install --file <settings>   merge into a settings file (backup first)
//   node scripts/claude-hooks.mjs install --user              same, for ~/.claude/settings.json
//   node scripts/claude-hooks.mjs uninstall --file <settings> | --user
//
// Existing hooks are kept; ours are recognised by the URL and added once.
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const root = resolve(dirname(new URL(import.meta.url).pathname), '..');
if (existsSync(join(root, '.env'))) process.loadEnvFile(join(root, '.env'));
const host = process.env.API_HOST || '127.0.0.1';
const port = process.env.API_PORT || '4400';
const URL_ = `http://${host}:${port}/api/agents/events`;

// stdin (the hook payload) goes straight to the API. -o /dev/null: hook stdout can reach Claude's context.
// -m 2 and `|| true`: never slow down or break Claude Code when the backoffice is not running.
const COMMAND = `curl -s -m 2 -o /dev/null -X POST -H 'content-type: application/json' --data-binary @- ${URL_} || true`;
const EVENTS = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Notification', 'Stop', 'SubagentStop', 'PreCompact', 'SessionEnd'];
const TOOL_EVENTS = new Set(['PreToolUse', 'PostToolUse']);
const isOurs = h => typeof h?.command === 'string' && h.command.includes('/api/agents/events');

function snippet() {
  const hooks = {};
  for (const e of EVENTS) hooks[e] = [{ ...(TOOL_EVENTS.has(e) ? { matcher: '*' } : {}), hooks: [{ type: 'command', command: COMMAND }] }];
  return { hooks };
}

function strip(settings) {
  for (const [event, groups] of Object.entries(settings.hooks ?? {})) {
    const kept = groups
      .map(g => ({ ...g, hooks: (g.hooks ?? []).filter(h => !isOurs(h)) }))
      .filter(g => g.hooks.length > 0);
    if (kept.length) settings.hooks[event] = kept;
    else delete settings.hooks[event];
  }
  return settings;
}

function targetFile(args) {
  if (args.includes('--user')) return join(homedir(), '.claude', 'settings.json');
  const i = args.indexOf('--file');
  if (i >= 0 && args[i + 1]) return resolve(args[i + 1]);
  console.error('Pass --file <path/to/settings.json> or --user');
  process.exit(1);
}

function write(file, settings) {
  mkdirSync(dirname(file), { recursive: true });
  if (existsSync(file)) {
    const backup = `${file}.bak-${new Date().toISOString().replace(/[:.]/g, '-')}`;
    copyFileSync(file, backup);
    console.log(`Backup: ${backup}`);
  }
  writeFileSync(file, `${JSON.stringify(settings, null, 2)}\n`);
}

const [cmd = 'print', ...args] = process.argv.slice(2);
if (cmd === 'print') {
  console.log(JSON.stringify(snippet(), null, 2));
} else if (cmd === 'install' || cmd === 'uninstall') {
  const file = targetFile(args);
  const settings = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
  strip(settings);
  if (cmd === 'install') {
    settings.hooks ??= {};
    for (const [event, groups] of Object.entries(snippet().hooks)) settings.hooks[event] = [...(settings.hooks[event] ?? []), ...groups];
  }
  write(file, settings);
  console.log(`${cmd === 'install' ? 'Added' : 'Removed'} Tesserax hooks (${EVENTS.length} events) ${cmd === 'install' ? 'to' : 'from'} ${file}`);
  console.log('New Claude Code sessions pick this up; restart running ones (or open /hooks) to apply.');
} else {
  console.error('usage: claude-hooks.mjs print | install (--file <path> | --user) | uninstall (--file <path> | --user)');
  process.exit(1);
}
