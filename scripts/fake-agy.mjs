#!/usr/bin/env node
// Stand-in for the Antigravity CLI (agy) in tests: ANTIGRAVITY_BIN=<repo>/scripts/fake-agy.mjs
// FAKE_AGY_MODE: ok (default) | auth | denied. Agent runs (--mode accept-edits) change a file in the folder.
import { appendFileSync } from 'node:fs';
const args = process.argv.slice(2);
const mode = process.env.FAKE_AGY_MODE ?? 'ok';
const printArg = args.find(a => a.startsWith('--print='));
const input = printArg ? printArg.slice('--print='.length) : '';
const out = o => process.stdout.write(`${JSON.stringify({ conversation_id: 'fake-agy', duration_seconds: 1, num_turns: 1, ...o })}\n`);
if (mode === 'auth') {
  console.error('error: authentication required. Run agy to sign in.');
  out({ status: 'ERROR', response: '', error: 'authentication required' });
  process.exit(1);
}
if (mode === 'denied') {
  console.error('jetski: no output produced');
  out({ status: 'SUCCESS', response: '', denied_actions: [{ action: 'command', display_name: 'RunCommand' }] });
  process.exit(0);
}
const editing = args[args.indexOf('--mode') + 1] === 'accept-edits';
if (editing) appendFileSync('README.md', '\n<!-- touched by fake agy -->\n');
const response = input.includes('VERDICT: PASS or VERDICT: FAIL')
  ? '## Criteria\nFake agy review.\n\nVERDICT: PASS'
  : `## Summary\nFake agy ${editing ? 'agent run' : 'answer'} (${input.length} chars of prompt).`;
out({ status: 'SUCCESS', response });
