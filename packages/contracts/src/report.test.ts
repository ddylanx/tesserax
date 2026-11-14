import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseStepReport, reportInstruction } from './index';

test('a full English block is parsed into its sections', () => {
  const text = [
    'I changed the DEMO login form.',
    '',
    'VERDICT: PASS',
    '',
    '## Summary',
    'Login now validates email.',
    'Tests added.',
    '## Result',
    'Done; 2 files changed.',
    '## Evidence (files, commands, links)',
    '- src/login.ts',
    '- pnpm test',
    '## Open questions',
    'None',
    '## Decision needed',
    '',
    '## Confidence',
    'High - tests cover both paths.',
  ].join('\n');
  const r = parseStepReport(text);
  assert.equal(r.structured, true);
  assert.equal(r.summary, 'Login now validates email.\nTests added.');
  assert.equal(r.result, 'Done; 2 files changed.');
  assert.equal(r.evidence, '- src/login.ts\n- pnpm test');
  assert.equal(r.openQuestions, null);
  assert.equal(r.decisionNeeded, null);
  assert.equal(r.confidence, 'high');
  assert.equal(r.confidenceWhy, 'tests cover both paths.');
});

test('without a block the summary is the first 5 non-empty lines (not an error)', () => {
  const r = parseStepReport('\n# Plan\n\nStep one\nStep two\n\nStep three\nStep four\nStep five\nStep six');
  assert.equal(r.structured, false);
  assert.equal(r.summary, '# Plan\nStep one\nStep two\nStep three\nStep four');
  assert.equal(r.confidence, null);
  assert.equal(r.decisionNeeded, null);
});

test('Vietnamese headings, a decision and a summary capped at 5 lines', () => {
  const text = [
    '## Tóm tắt', 'a', 'b', 'c', 'd', 'e', 'f',
    '## Kết quả', 'Xong.',
    '## Bằng chứng', 'src/a.ts',
    '## Câu hỏi mở', 'Có cần giữ API cũ không?',
    '## Cần quyết định', 'Chọn A hay B cho DEMO.',
    '## Độ tin cậy', 'trung bình: chưa chạy test e2e',
  ].join('\n');
  const r = parseStepReport(text);
  assert.equal(r.summary, 'a\nb\nc\nd\ne');
  assert.equal(r.openQuestions, 'Có cần giữ API cũ không?');
  assert.equal(r.decisionNeeded, 'Chọn A hay B cho DEMO.');
  assert.equal(r.confidence, 'medium');
  assert.equal(r.confidenceWhy, 'chưa chạy test e2e');
});

test('the last block wins and copied hints are ignored; the instruction has the headings', () => {
  const r = parseStepReport('## Summary\nold\n\nmore text\n\n## Summary\n(at most 5 lines)\nnew\n## Decision needed\n(leave empty when there is none)\n## Confidence\nlow');
  assert.equal(r.summary, 'new');
  assert.equal(r.decisionNeeded, null);
  assert.equal(r.confidence, 'low');
  assert.ok(reportInstruction('vi').includes('## Cần quyết định'));
  assert.ok(reportInstruction().includes('## Decision needed'));
});

test('improvement proposals: rules with a reason, a context request, capped per step', () => {
  const text = [
    '## Summary', 'Done.',
    '## Confidence', 'high',
    '## Improvement proposals',
    '(optional, at most 3 lines, each "- <a rule> | <what happened>")',
    '- Check the DEMO price table against the signed quote before writing numbers | the owner sent the page back for an old price',
    '- context: pricing-notes | the task asked for a price I was not given',
    '* None',
    '1. Ask before renaming a public field',
    '- a fourth one that is dropped',
  ].join('\n');
  const r = parseStepReport(text);
  assert.equal(r.confidence, 'high');
  assert.deepEqual(r.improvements, [
    { kind: 'lesson', text: 'Check the DEMO price table against the signed quote before writing numbers', reason: 'the owner sent the page back for an old price', pack: null },
    { kind: 'context', text: 'the task asked for a price I was not given', reason: 'the task asked for a price I was not given', pack: 'pricing-notes' },
    { kind: 'lesson', text: 'Ask before renaming a public field', reason: '', pack: null },
  ]);
  assert.deepEqual(parseStepReport('## Summary\nx\n## Đề xuất cải tiến\nKhông có').improvements, []);
  assert.match(reportInstruction('vi'), /## Đề xuất cải tiến/);
});
