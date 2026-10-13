import { Check, Copy, Eye, FileText, Maximize2, X } from 'lucide-react';
import { Fragment, useEffect, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/* ---------- inline ---------- */

const INLINE = /(`[^`\n]+`)|(\*\*[^*\n]+\*\*|__[^_\n]+__)|(~~[^~\n]+~~)|(\[[^\]\n]+\]\([^)\s]+\))|(https?:\/\/[^\s<>)]+)|(\*[^*\n]+\*|(?<![\w])_[^_\n]+_(?![\w]))/g;
const safeHref = (u: string) => (/^(https?:|mailto:)/i.test(u) ? u : null);

function inline(text: string, key = ''): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let i = 0;
  for (const m of text.matchAll(INLINE)) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const k = `${key}${i++}`;
    const [tok] = m;
    if (m[1]) out.push(<code key={k} className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]">{tok.slice(1, -1)}</code>);
    else if (m[2]) out.push(<strong key={k}>{inline(tok.slice(2, -2), `${k}b`)}</strong>);
    else if (m[3]) out.push(<del key={k}>{inline(tok.slice(2, -2), `${k}d`)}</del>);
    else if (m[4]) {
      const [, label, url] = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(tok)!;
      const href = safeHref(url!);
      out.push(href
        ? <a key={k} href={href} target="_blank" rel="noreferrer" className="text-sky-600 underline-offset-2 hover:underline">{inline(label!, `${k}l`)}</a>
        : <span key={k}>{inline(label!, `${k}l`)}</span>); // file:// and other schemes: text only
    } else if (m[5]) out.push(<a key={k} href={tok} target="_blank" rel="noreferrer" className="break-all text-sky-600 hover:underline">{tok}</a>);
    else out.push(<em key={k}>{inline(tok.slice(1, -1), `${k}i`)}</em>);
    last = m.index + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/* ---------- blocks ---------- */

const isTableSep = (l: string) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l) && l.includes('-');
const cells = (l: string) => l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim());
const LIST = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;

interface Item { text: string; children: Item[]; ordered: boolean; num: number }

function parseList(lines: string[], start: number): { items: Item[]; next: number; ordered: boolean } {
  const base = LIST.exec(lines[start]!)![1]!.length;
  const ordered = /\d/.test(LIST.exec(lines[start]!)![2]!);
  const items: Item[] = [];
  let i = start;
  while (i < lines.length) {
    const m = LIST.exec(lines[i]!);
    if (!m) {
      // a continuation line (indented, not a new block) extends the previous item
      if (items.length && /^\s{2,}\S/.test(lines[i]!) && !/^\s*(```|>|#)/.test(lines[i]!)) {
        items.at(-1)!.text += ` ${lines[i]!.trim()}`;
        i++;
        continue;
      }
      break;
    }
    const indent = m[1]!.length;
    if (indent < base) break;
    if (indent > base) {
      const sub = parseList(lines, i);
      items.at(-1)?.children.push(...sub.items);
      i = sub.next;
      continue;
    }
    items.push({ text: m[3]!, children: [], ordered: /\d/.test(m[2]!), num: parseInt(m[2]!, 10) });
    i++;
  }
  return { items, next: i, ordered };
}

function renderItems(items: Item[], ordered: boolean, key: string): ReactNode {
  const Tag = ordered ? 'ol' : 'ul';
  return (
    <Tag key={key} {...(ordered && items[0] && Number.isFinite(items[0].num) ? { start: items[0].num } : {})} className={cn('my-1.5 flex flex-col gap-0.5 pl-5', ordered ? 'list-decimal' : 'list-disc')}>
      {items.map((it, n) => {
        const task = /^\[( |x|X)\]\s+(.*)$/.exec(it.text);
        return (
          <li key={n}>
            {task ? <><input type="checkbox" readOnly checked={task[1] !== ' '} className="mr-1.5 align-middle" />{inline(task[2]!, `${key}${n}`)}</> : inline(it.text, `${key}${n}`)}
            {it.children.length > 0 && renderItems(it.children, it.children[0]!.ordered, `${key}${n}c`)}
          </li>
        );
      })}
    </Tag>
  );
}

const HEADING_CLASS = ['', 'text-xl font-semibold mt-4 mb-2 border-b pb-1', 'text-lg font-semibold mt-4 mb-1.5 border-b pb-1', 'text-base font-semibold mt-3 mb-1', 'text-sm font-semibold mt-3 mb-1', 'text-sm font-semibold mt-2 mb-1', 'text-xs font-semibold mt-2 mb-1 uppercase tracking-wide'];

function blocks(src: string, keyPrefix = ''): ReactNode[] {
  const lines = src.replace(/\r\n?/g, '\n').split('\n');
  const out: ReactNode[] = [];
  let i = 0;
  const key = () => `${keyPrefix}b${out.length}`;
  while (i < lines.length) {
    const line = lines[i]!;
    if (!line.trim()) { i++; continue; }
    const fence = /^\s*(```|~~~)\s*([\w+-]*)/.exec(line);
    if (fence) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i]!.trim().startsWith(fence[1]!)) body.push(lines[i++]!);
      i++;
      out.push(
        <pre key={key()} className="my-2 overflow-auto rounded-md border bg-muted/60 p-2.5 font-mono text-xs leading-relaxed">
          {fence[2] && <span className="mb-1 block text-[10px] uppercase tracking-wide text-muted-foreground">{fence[2]}</span>}
          <code>{body.join('\n')}</code>
        </pre>,
      );
      continue;
    }
    const h = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (h) {
      const level = h[1]!.length;
      const Tag = `h${level}` as 'h1';
      out.push(<Tag key={key()} className={HEADING_CLASS[level]}>{inline(h[2]!, key())}</Tag>);
      i++;
      continue;
    }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) { out.push(<hr key={key()} className="my-3" />); i++; continue; }
    if (/^\s*>/.test(line)) {
      const q: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i]!)) q.push(lines[i++]!.replace(/^\s*>\s?/, ''));
      out.push(<blockquote key={key()} className="my-2 border-l-4 pl-3 text-muted-foreground">{blocks(q.join('\n'), key())}</blockquote>);
      continue;
    }
    if (line.includes('|') && i + 1 < lines.length && isTableSep(lines[i + 1]!)) {
      const head = cells(line);
      const align = cells(lines[i + 1]!).map(c => (c.startsWith(':') && c.endsWith(':') ? 'center' : c.endsWith(':') ? 'right' : 'left'));
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i]!.includes('|') && lines[i]!.trim()) rows.push(cells(lines[i++]!));
      out.push(
        <div key={key()} className="my-2 overflow-auto">
          <table className="w-full border-collapse text-xs">
            <thead><tr>{head.map((c, n) => <th key={n} style={{ textAlign: align[n] as 'left' }} className="border bg-muted/60 px-2 py-1 font-semibold">{inline(c)}</th>)}</tr></thead>
            <tbody>{rows.map((r, n) => <tr key={n}>{head.map((_, m) => <td key={m} style={{ textAlign: align[m] as 'left' }} className="border px-2 py-1 align-top">{inline(r[m] ?? '')}</td>)}</tr>)}</tbody>
          </table>
        </div>,
      );
      continue;
    }
    if (LIST.test(line)) {
      const { items, next, ordered } = parseList(lines, i);
      out.push(renderItems(items, ordered, key()));
      i = next;
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i]!.trim() && !/^\s*(```|~~~|#{1,6}\s|>|([-*_])(\s*\2){2,}\s*$)/.test(lines[i]!) && !LIST.test(lines[i]!)
      && !(lines[i]!.includes('|') && i + 1 < lines.length && isTableSep(lines[i + 1]!))) para.push(lines[i++]!);
    out.push(<p key={key()} className="my-1.5 leading-relaxed">{para.map((l, n) => <Fragment key={n}>{n > 0 && <br />}{inline(l.trim(), `${key()}${n}`)}</Fragment>)}</p>);
  }
  return out;
}

/** Markdown as read-only React elements (no HTML injection). Headings, lists, tables, code, quotes, links, inline styles. */
export function Markdown({ text, className }: { text: string; className?: string }) {
  return <div className={cn('text-sm [overflow-wrap:anywhere]', className)}>{blocks(text)}</div>;
}

/* ---------- panel: preview / source, copy, full page ---------- */

export function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const t = document.createElement('textarea'); // clipboard API needs https or localhost; fall back
      t.value = text;
      document.body.appendChild(t);
      t.select();
      document.execCommand('copy');
      t.remove();
    }
    setDone(true);
    setTimeout(() => setDone(false), 1500);
  };
  return (
    <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={copy} title="Copy the markdown text">
      {done ? <Check className="size-3.5 text-green-600" /> : <Copy className="size-3.5" />}{done ? 'Copied' : label}
    </Button>
  );
}

/**
 * A document for a person to read: rendered preview by default, source on demand, copy, and a full-page view.
 * With `onChange` the source view is an editor (the review a person corrects before approving).
 */
export function MarkdownPanel({ title, text, onChange, extra, maxHeight = 'max-h-96', startInSource = false }: {
  title?: ReactNode; text: string; onChange?: (v: string) => void; extra?: ReactNode; maxHeight?: string; startInSource?: boolean;
}) {
  const [mode, setMode] = useState<'preview' | 'source'>(startInSource ? 'source' : 'preview');
  const [full, setFull] = useState(false);
  useEffect(() => {
    if (!full) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setFull(false);
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [full]);

  const toolbar = (
    <div className="flex flex-wrap items-center gap-1">
      {title && <span className="mr-auto text-xs font-medium">{title}</span>}
      {extra}
      <div className="inline-flex overflow-hidden rounded-md border text-xs">
        <button className={cn('flex items-center gap-1 px-2 py-1', mode === 'preview' ? 'bg-accent font-medium' : 'hover:bg-accent/50')} onClick={() => setMode('preview')}><Eye className="size-3.5" />Preview</button>
        <button className={cn('flex items-center gap-1 border-l px-2 py-1', mode === 'source' ? 'bg-accent font-medium' : 'hover:bg-accent/50')} onClick={() => setMode('source')}><FileText className="size-3.5" />{onChange ? 'Edit' : 'Source'}</button>
      </div>
      <CopyButton text={text} />
      <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => setFull(v => !v)} title="Full page (Esc to close)">
        {full ? <X className="size-3.5" /> : <Maximize2 className="size-3.5" />}{full ? 'Close' : 'Full page'}
      </Button>
    </div>
  );
  const body = (height: string) => mode === 'preview'
    ? <div className={cn('overflow-auto rounded-md border bg-background p-3', height)}><Markdown text={text || '_(empty)_'} /></div>
    : onChange
      ? <textarea className={cn('min-h-64 w-full rounded-md border bg-background p-2 font-mono text-xs leading-relaxed', full && 'h-full')} value={text} onChange={e => onChange(e.target.value)} />
      : <pre className={cn('overflow-auto whitespace-pre-wrap rounded-md border bg-muted/40 p-2 font-mono text-xs leading-relaxed', height)}>{text}</pre>;

  if (full) {
    return (
      <>
        <div className="text-xs text-muted-foreground">{title} is open in full page.</div>
        <div className="fixed inset-0 z-50 flex flex-col gap-2 bg-background p-4 md:p-8" role="dialog" aria-modal="true">
          {toolbar}
          <div className="mx-auto flex min-h-0 w-full max-w-4xl flex-1 flex-col">{body('flex-1 max-h-none')}</div>
        </div>
      </>
    );
  }
  return <div className="flex flex-col gap-1.5">{toolbar}{body(maxHeight)}</div>;
}
