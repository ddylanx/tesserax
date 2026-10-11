// Ported from agent-cockpit/src/jira.mjs (adfToText), same author, MIT.

interface AdfNode {
  type?: string;
  text?: string;
  attrs?: Record<string, unknown>;
  content?: AdfNode[];
}

/** Jira rich text (Atlassian Document Format) -> plain text with line breaks and list bullets. */
export function adfToText(node: unknown, depth = 0): string {
  if (!node) return '';
  if (typeof node === 'string') return node;
  const n = node as AdfNode;
  const listDepth = n.type === 'bulletList' || n.type === 'orderedList' ? 1 : 0;
  const kids = (n.content ?? []).map(k => adfToText(k, depth + listDepth));
  switch (n.type) {
    case 'text':
      return n.text ?? '';
    case 'hardBreak':
      return '\n';
    case 'mention':
      return String(n.attrs?.text ?? '');
    case 'inlineCard':
    case 'blockCard':
      return String(n.attrs?.url ?? '');
    case 'listItem':
      return `${'  '.repeat(Math.max(0, depth - 1))}- ${kids.join('').trim()}\n`;
    case 'heading':
    case 'paragraph':
      return `${kids.join('')}\n\n`;
    case 'codeBlock':
      return `\`\`\`\n${kids.join('')}\n\`\`\`\n\n`;
    default:
      return kids.join('');
  }
}

export const richText = (v: unknown, max = 8000): string | null =>
  (typeof v === 'string' ? v : adfToText(v)).replace(/\n{3,}/g, '\n\n').trim().slice(0, max) || null;
