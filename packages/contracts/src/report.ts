import { CONTEXT_LIMITS, type ProposedImprovement } from './context';
import type { ReportLanguage } from './team';

/**
 * Step report: a role-driven step ends its output with a fixed block, so a person (or the manager AI) can read the outcome
 * without reading the whole document. Parsing never fails: without the block the summary is the first lines of the text.
 */
export const REPORT_SECTIONS = ['summary', 'result', 'evidence', 'questions', 'decision', 'confidence', 'improve'] as const;
export type ReportSection = (typeof REPORT_SECTIONS)[number];

export const REPORT_HEADINGS: Record<ReportLanguage, Record<ReportSection, string>> = {
  en: { summary: 'Summary', result: 'Result', evidence: 'Evidence', questions: 'Open questions', decision: 'Decision needed', confidence: 'Confidence', improve: 'Improvement proposals' },
  vi: { summary: 'Tóm tắt', result: 'Kết quả', evidence: 'Bằng chứng', questions: 'Câu hỏi mở', decision: 'Cần quyết định', confidence: 'Độ tin cậy', improve: 'Đề xuất cải tiến' },
};

export const CONFIDENCE_LEVELS = ['high', 'medium', 'low'] as const;
export type Confidence = (typeof CONFIDENCE_LEVELS)[number];

export interface StepReport {
  /** At most 5 lines. */
  summary: string;
  result: string | null;
  evidence: string | null;
  openQuestions: string | null;
  /** null = nothing to decide. */
  decisionNeeded: string | null;
  confidence: Confidence | null;
  confidenceWhy: string | null;
  /** How the role says it could do its job better next time (at most CONTEXT_LIMITS.perStep); the owner decides on the Context page. */
  improvements: ProposedImprovement[];
  /** false when the text had no report block (summary is then the first lines of the text). */
  structured: boolean;
}

/** What a role-driven step is told to end its answer with. */
export function reportInstruction(lang: ReportLanguage = 'en'): string {
  const h = REPORT_HEADINGS[lang];
  const intro = lang === 'vi'
    ? 'Kết thúc câu trả lời bằng đúng khối báo cáo dưới đây (giữ nguyên các tiêu đề, viết bằng tiếng Việt):'
    : 'End your answer with exactly this report block (keep the headings):';
  return [
    intro,
    '',
    `## ${h.summary}`, lang === 'vi' ? '(tối đa 5 dòng)' : '(at most 5 lines)',
    `## ${h.result}`,
    `## ${h.evidence}`, lang === 'vi' ? '(file, lệnh, link)' : '(files, commands, links)',
    `## ${h.questions}`,
    `## ${h.decision}`, lang === 'vi' ? '(để trống nếu không cần)' : '(leave empty when there is none)',
    `## ${h.confidence}`, lang === 'vi' ? '(high | medium | low, và vì sao)' : '(high | medium | low, and why)',
    `## ${h.improve}`,
    lang === 'vi'
      ? `(tuỳ chọn, tối đa ${CONTEXT_LIMITS.perStep} dòng, mỗi dòng "- <quy tắc giúp vai này làm tốt hơn lần sau> | <chuyện gì đã xảy ra>"; cần gói context chưa được cấp thì viết "- context: <slug gói> | <vì sao>"; nhất là khi bài bị gửi lại: nêu quy tắc lẽ ra đã tránh được; để trống nếu không có)`
      : `(optional, at most ${CONTEXT_LIMITS.perStep} lines, each "- <a rule that would make this role do better next time> | <what happened>"; to ask for context you were not given write "- context: <pack slug> | <why>"; above all when your work was sent back: the rule that would have avoided it; leave empty when there is none)`,
  ].join('\n');
}

const norm = (s: string) => s.normalize('NFC').toLowerCase().trim();
const HEADING_TO_SECTION = new Map<string, ReportSection>(
  Object.values(REPORT_HEADINGS).flatMap(h => Object.entries(h).map(([k, v]) => [norm(v), k as ReportSection] as const)),
);
const NONE = new Set(['', '-', 'none', 'n/a', 'no', 'không', 'không có', '(none)', '(không)']);
const CONFIDENCE_WORDS: Record<string, Confidence> = { high: 'high', medium: 'medium', low: 'low', cao: 'high', 'trung bình': 'medium', thấp: 'low' };

/** `## Heading (hint)` -> section, else null. */
function sectionOf(line: string): ReportSection | null {
  const m = /^#{2,3}\s+(.+?)\s*(?:\(.*\))?\s*:?\s*$/.exec(line.trim());
  return m ? HEADING_TO_SECTION.get(norm(m[1]!)) ?? null : null;
}

const firstLines = (text: string, n: number) => text.split('\n').map(l => l.trim()).filter(Boolean).slice(0, n).join('\n');
const orNull = (s: string | undefined) => {
  const t = s?.trim() ?? '';
  return NONE.has(norm(t).replace(/[.。]$/, '')) ? null : t;
};

export function parseStepReport(text: string): StepReport {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  // the block is at the end: start from the last summary heading
  let start = -1;
  lines.forEach((l, i) => { if (sectionOf(l) === 'summary') start = i; });
  if (start < 0) {
    return { summary: firstLines(text, 5), result: null, evidence: null, openQuestions: null, decisionNeeded: null, confidence: null, confidenceWhy: null, improvements: [], structured: false };
  }
  const parts: Partial<Record<ReportSection, string[]>> = {};
  let current: ReportSection | null = null;
  for (const line of lines.slice(start)) {
    const s = sectionOf(line);
    if (s) {
      current = s;
      parts[s] = [];
    } else if (current) {
      parts[current]!.push(line);
    }
  }
  // drop the "(at most 5 lines)"-style hints a model may copy from the instruction
  const body = (s: ReportSection) => parts[s]?.filter(l => !/^\((at most|tối đa|files|file,|leave empty|để trống|high \||optional|tuỳ chọn)/i.test(l.trim())).join('\n').trim();
  const conf = body('confidence') ?? '';
  const level = Object.entries(CONFIDENCE_WORDS).find(([w]) => norm(conf).startsWith(w))?.[1] ?? null;
  return {
    summary: firstLines(body('summary') ?? '', 5),
    result: orNull(body('result')),
    evidence: orNull(body('evidence')),
    openQuestions: orNull(body('questions')),
    decisionNeeded: orNull(body('decision')),
    confidence: level,
    confidenceWhy: orNull(conf.replace(/^\**\s*(high|medium|low|cao|trung bình|thấp)\b\**\s*[-–—:,.]?\s*/i, '')),
    improvements: parseImprovements(body('improve') ?? ''),
    structured: true,
  };
}

/** `- rule | reason` and `- context: pack-slug | reason` lines; anything else in the section is ignored. */
export function parseImprovements(text: string): ProposedImprovement[] {
  const out: ProposedImprovement[] = [];
  for (const line of text.split('\n')) {
    const m = /^\s*(?:[-*•]|\d+[.)])\s+(.+)$/.exec(line);
    if (!m) continue;
    const [head = '', ...rest] = m[1]!.split(/\s+\|\s+/);
    const reason = rest.join(' | ').trim().slice(0, CONTEXT_LIMITS.reason);
    const ctx = /^context\s*:\s*`?([a-z0-9]+(?:-[a-z0-9]+)*)`?\s*(.*)$/i.exec(head.trim());
    const text = (ctx ? ctx[2]!.trim() || reason || `Needs the context pack ${ctx[1]}` : head.trim()).slice(0, CONTEXT_LIMITS.lesson);
    if (text.length < 3 || NONE.has(norm(text).replace(/[.。]$/, ''))) continue;
    out.push({ kind: ctx ? 'context' : 'lesson', text, reason, pack: ctx ? ctx[1]!.toLowerCase() : null });
    if (out.length >= CONTEXT_LIMITS.perStep) break;
  }
  return out;
}
