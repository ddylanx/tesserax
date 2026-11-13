import type { ButtonHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';
import { focusRing } from './button';

/** A toggle in a filter row: selected chips use the accent tint, never the filled primary look. */
export const FilterChip = ({ active, className, ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { active: boolean }) => (
  <button
    type="button"
    aria-pressed={active}
    className={cn(
      'inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium transition-colors',
      focusRing,
      active ? 'border-primary/30 bg-primary/10 text-primary' : 'bg-card text-muted-foreground hover:bg-accent hover:text-foreground',
      className,
    )}
    {...p}
  />
);
