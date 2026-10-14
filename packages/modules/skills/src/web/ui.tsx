import { cva, type VariantProps } from 'class-variance-authority';
import { type ClassValue, clsx } from 'clsx';
import type { ButtonHTMLAttributes, HTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react';
import { twMerge } from 'tailwind-merge';

export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs));

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

const button = cva(
  'inline-flex items-center justify-center gap-1.5 rounded-md text-sm font-medium transition-colors disabled:opacity-50 disabled:pointer-events-none',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:opacity-90',
        outline: 'border bg-card hover:bg-accent',
        ghost: 'hover:bg-accent',
      },
      size: { default: 'h-8 px-3', sm: 'h-7 px-2 text-xs' },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);

export const Button = ({ className, variant, size, ...p }: ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof button>) => (
  <button className={cn(button({ variant, size }), className)} {...p} />
);

export const Card = ({ className, ...p }: HTMLAttributes<HTMLDivElement>) => (
  <div className={cn('rounded-xl border bg-card shadow-sm', className)} {...p} />
);

export const CardHeader = ({ className, ...p }: HTMLAttributes<HTMLDivElement>) => (
  <div className={cn('flex flex-col gap-1 p-4 pb-2', className)} {...p} />
);

export const CardTitle = ({ className, ...p }: HTMLAttributes<HTMLHeadingElement>) => (
  <h3 className={cn('text-sm font-semibold', className)} {...p} />
);

export const CardContent = ({ className, ...p }: HTMLAttributes<HTMLDivElement>) => (
  <div className={cn('p-4 pt-2', className)} {...p} />
);

export const Input = ({ className, ...p }: InputHTMLAttributes<HTMLInputElement>) => (
  <input className={cn('h-8 rounded-md border bg-card px-2.5 text-sm outline-none focus:ring-2 focus:ring-primary/20', className)} {...p} />
);

export const Select = ({ className, ...p }: SelectHTMLAttributes<HTMLSelectElement>) => (
  <select className={cn('h-8 rounded-md border bg-card px-2 text-sm outline-none', className)} {...p} />
);

export function QueryState({ isLoading, error, empty, emptyText }: { isLoading: boolean; error: unknown; empty?: boolean; emptyText?: string }) {
  if (isLoading) return <p className="p-4 text-sm text-muted-foreground">Loading…</p>;
  if (error) return <p className="p-4 text-sm text-red-600">{String((error as Error).message ?? error)}</p>;
  if (empty) return <p className="p-4 text-sm text-muted-foreground">{emptyText ?? 'Nothing here yet.'}</p>;
  return null;
}
