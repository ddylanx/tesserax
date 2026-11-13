import type { InputHTMLAttributes, SelectHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

export const Input = ({ className, ...p }: InputHTMLAttributes<HTMLInputElement>) => (
  <input className={cn('h-8 rounded-md border bg-card px-2.5 text-sm outline-none focus:border-ring/60 focus:ring-2 focus:ring-ring/25', className)} {...p} />
);
export const Select = ({ className, ...p }: SelectHTMLAttributes<HTMLSelectElement>) => (
  <select className={cn('h-8 rounded-md border bg-card px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/40', className)} {...p} />
);
