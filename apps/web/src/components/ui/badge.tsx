import { cva, type VariantProps } from 'class-variance-authority';
import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

const badge = cva('inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs font-medium whitespace-nowrap', {
  variants: {
    variant: {
      default: 'bg-muted text-foreground',
      green: 'border-success/30 bg-success/10 text-success',
      amber: 'border-warning/30 bg-warning/10 text-warning',
      blue: 'border-info/30 bg-info/10 text-info',
      red: 'border-destructive/30 bg-destructive/10 text-destructive',
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
