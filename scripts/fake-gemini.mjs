#!/usr/bin/env node
// Stand-in for the Gemini CLI in tests: GEMINI_BIN=<repo>/scripts/fake-gemini.mjs
// FAKE_GEMINI_MODE: ok (default) | auth. Agent runs (--approval-mode auto_edit) change a file in the folder.
import { appendFileSync } from 'node:fs';
const args = process.argv.slice(2);
const mode = process.env.FAKE_GEMINI_MODE ?? 'ok';
let input = '';
process.stdin.on('data', d => (input += d));
process.stdin.on('end', () => {
  const sid = 'fake-gemini-session';
  if (mode === 'auth') {
    process.stdout.write(JSON.stringify({ session_id: sid, error: { type: 'Error', message: 'Please set an Auth method in your settings.json or specify one of the following environment variables before running: GEMINI_API_KEY' } }));
    process.exit(41);
  }
  const editing = args[args.indexOf('--approval-mode') + 1] === 'auto_edit';
  if (editing) appendFileSync('README.md', '\n<!-- touched by fake gemini -->\n');
  const response = input.includes('VERDICT: PASS or VERDICT: FAIL')
    ? '## Criteria\nFake gemini review.\n\nVERDICT: PASS'
    : `## Summary\nFake gemini ${editing ? 'agent run' : 'answer'} (${input.length} chars of prompt).`;
  process.stdout.write(JSON.stringify({ session_id: sid, response, stats: {} }));
});
