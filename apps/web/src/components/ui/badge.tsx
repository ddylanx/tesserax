import { cva, type VariantProps } from 'class-variance-authority';
import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

const badge = cva('inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs font-medium whitespace-nowrap', {
  variants: {
    variant: {
      default: 'bg-muted text-foreground',
      green: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
      amber: 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400',
      blue: 'border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-400',
      red: 'border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-400',
      purple: 'border-purple-500/30 bg-purple-500/10 text-purple-700 dark:text-purple-400',
      indigo: 'border-indigo-500/30 bg-indigo-500/10 text-indigo-700 dark:text-indigo-400',
      slate: 'border-slate-500/30 bg-slate-500/10 text-slate-700 dark:text-slate-300',
      outline: 'text-muted-foreground',
    },
  },
  defaultVariants: { variant: 'default' },
});

export const Badge = ({ className, variant, ...p }: HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badge>) => (
  <span className={cn(badge({ variant }), className)} {...p} />
);
