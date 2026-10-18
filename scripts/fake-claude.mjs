#!/usr/bin/env node
// Stand-in for the `claude` CLI in tests: CLAUDE_BIN=<repo>/scripts/fake-claude.mjs
// FAKE_CLAUDE_MODE: ok (default) | auth | quota | hang | invalid | crash ; FAKE_CLAUDE_SLEEP=<seconds> for runs.
import { appendFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

const mode = process.env.FAKE_CLAUDE_MODE ?? 'ok';
const args = process.argv.slice(2);
const sid = args.includes('--session-id') ? args[args.indexOf('--session-id') + 1] : randomUUID();
let input = '';
process.stdin.on('data', d => (input += d));
process.stdin.on('end', async () => {
  const out = (o, code = 0) => { process.stdout.write(JSON.stringify({ type: 'result', session_id: sid, duration_ms: 1200, num_turns: 3, total_cost_usd: 0.0123, ...o }) + '\n'); process.exitCode = code; };
  if (mode === 'crash') { process.stderr.write('fake crash\n'); process.exit(2); }
  if (mode === 'auth') return out({ subtype: 'success', is_error: true, result: 'Failed to authenticate. API Error: 401 {"type":"error","error":{"type":"authentication_error","message":"OAuth access token is invalid."}}' }, 1);
  if (mode === 'quota') return out({ subtype: 'success', is_error: true, result: 'Claude AI usage limit reached. Your limit will reset at 5pm.' }, 1);
  if (input.includes('Classify the issue below')) {
    if (mode === 'invalid') return out({ subtype: 'success', is_error: false, result: 'I think it is a bug.' });
    const issue = input.slice(input.indexOf('<issue>'), input.indexOf('</issue>'));
    const bug = /type: bug|Safari|crash|exception/i.test(issue);
    const reply = { type: bug ? 'bug' : 'question', automation: bug ? 'assisted' : 'auto', repo: null, confidence: 0.82, reasoning: 'Fake classifier: keyword match.' };
    out({ subtype: 'success', is_error: false, result: '```json\n' + JSON.stringify(reply) + '\n```' });
    if (mode === 'hang') setInterval(() => {}, 1000);
    return;
  }
  const headless = args.includes('--session-id'); // agent runs pass a session id; read-only AI steps do not
  if (!headless && input.includes('VERDICT: PASS or VERDICT: FAIL')) {
    // FAKE_REVIEW=pass (default) | fail | fail-once (fails the first review in this folder, then passes)
    const want = process.env.FAKE_REVIEW ?? 'pass';
    let verdict = want === 'fail' ? 'FAIL' : 'PASS';
    if (want === 'fail-once') {
      const { existsSync } = await import('node:fs');
      verdict = existsSync('.ot-fake-reviewed') ? 'PASS' : 'FAIL';
      writeFileSync('.ot-fake-reviewed', '1');
    }
    return out({ subtype: 'success', is_error: false, result: `## Criteria\nFake review.\n\n## Problems\n${verdict === 'FAIL' ? '- Missing test for criterion 1' : 'None'}\n\nVERDICT: ${verdict}` });
  }
  if (!headless) {
    const name = (input.match(/# Skill: ([\w-]+)/) ?? [])[1] ?? 'step';
    const fb = input.includes('asks for these changes') ? '\n\n(Revised after developer feedback.)' : '';
    return out({ subtype: 'success', is_error: false, result: `## Summary\nFake output of ${name} for the ticket.${fb}\n\n## Details\n- point one\n- point two` });
  }
  // agent run: make a visible change in the working folder
  await new Promise(r => setTimeout(r, Number(process.env.FAKE_CLAUDE_SLEEP ?? 1) * 1000));
  writeFileSync('OT_FAKE_CHANGE.md', `fake agent change\n`);
  appendFileSync('README.md', `\n<!-- touched by fake agent ${sid} -->\n`);
  out({ subtype: 'success', is_error: false, result: `## Summary\nFake run of the agent.\n\n- Read the issue\n- Changed README.md and added OT_FAKE_CHANGE.md\n\nPrompt length: ${input.length} chars.` });
});
