import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

export type Tone = 'success' | 'warning' | 'info' | 'destructive' | 'neutral';

const TONE: Record<Tone, { pill: string; dot: string }> = {
  success: { pill: 'bg-success/10 text-success', dot: 'bg-success' },
  warning: { pill: 'bg-warning/12 text-warning', dot: 'bg-warning' },
  info: { pill: 'bg-info/10 text-info', dot: 'bg-info' },
  destructive: { pill: 'bg-destructive/10 text-destructive', dot: 'bg-destructive' },
  neutral: { pill: 'bg-muted text-muted-foreground', dot: 'bg-muted-foreground/60' },
};

export const toneClasses = (tone: Tone) => TONE[tone];

/** The one way to show a state: a dot and a short label, colored by tone. */
export function StatusPill({ tone, pulse, className, children, ...p }: HTMLAttributes<HTMLSpanElement> & { tone: Tone; pulse?: boolean }) {
  const t = TONE[tone];
  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-xs font-medium whitespace-nowrap', t.pill, className)} {...p}>
      <span className={cn('size-1.5 shrink-0 rounded-full', t.dot, pulse && 'animate-pulse')} />
      {children}
    </span>
  );
}

/** A neutral label (kind, type, label): never colored, so states stand out. */
export const Tag = ({ className, ...p }: HTMLAttributes<HTMLSpanElement>) => (
  <span className={cn('inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs whitespace-nowrap text-muted-foreground', className)} {...p} />
);

/** A count next to a nav item or tab; renders nothing for 0. */
export function Count({ n, tone = 'neutral', className }: { n: number | undefined; tone?: Tone; className?: string }) {
  if (!n) return null;
  return <span className={cn('rounded-full px-1.5 font-mono text-[11px] leading-[18px] tabular-nums', TONE[tone].pill, className)}>{n}</span>;
}
