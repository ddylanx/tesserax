import type { ReportLanguage } from './team';

/**
 * Step report: a role-driven step ends its output with a fixed block, so a person (or the manager AI) can read the outcome
 * without reading the whole document. Parsing never fails: without the block the summary is the first lines of the text.
 */
export const REPORT_SECTIONS = ['summary', 'result', 'evidence', 'questions', 'decision', 'confidence'] as const;
export type ReportSection = (typeof REPORT_SECTIONS)[number];

export const REPORT_HEADINGS: Record<ReportLanguage, Record<ReportSection, string>> = {
  en: { summary: 'Summary', result: 'Result', evidence: 'Evidence', questions: 'Open questions', decision: 'Decision needed', confidence: 'Confidence' },
  vi: { summary: 'Tóm tắt', result: 'Kết quả', evidence: 'Bằng chứng', questions: 'Câu hỏi mở', decision: 'Cần quyết định', confidence: 'Độ tin cậy' },
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
    return { summary: firstLines(text, 5), result: null, evidence: null, openQuestions: null, decisionNeeded: null, confidence: null, confidenceWhy: null, structured: false };
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
  const body = (s: ReportSection) => parts[s]?.filter(l => !/^\((at most|tối đa|files|file,|leave empty|để trống|high \|)/i.test(l.trim())).join('\n').trim();
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
    structured: true,
  };
}
