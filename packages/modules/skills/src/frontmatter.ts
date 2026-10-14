import { createHash } from 'node:crypto';

export const sha = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 12);

/** Frontmatter field, including YAML folded/literal blocks (`description: >`). */
export function frontmatterField(text: string, key: string): string {
  const fm = text.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1] ?? '';
  const lines = fm.split(/\r?\n/);
  const i = lines.findIndex(l => l.startsWith(`${key}:`));
  if (i < 0) return '';
  const first = lines[i]!.slice(key.length + 1).trim();
  if (!/^[>|][-+]?$/.test(first)) return first.replace(/^(["'])(.*)\1$/, '$2');
  const block: string[] = [];
  for (const l of lines.slice(i + 1)) {
    if (l.trim() && !/^\s/.test(l)) break;
    block.push(l.trim());
  }
  return block.join(first.startsWith('|') ? '\n' : ' ').trim();
}

/** SKILL.md text → name/description from the frontmatter, body after it. */
export function parseSkill(text: string, fallbackName: string): { name: string; description: string; body: string } {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  return {
    name: frontmatterField(text, 'name') || fallbackName,
    description: frontmatterField(text, 'description'),
    body: (m?.[2] ?? text).trim(),
  };
}
