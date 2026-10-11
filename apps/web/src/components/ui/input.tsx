import type { InputHTMLAttributes, SelectHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

export const Input = ({ className, ...p }: InputHTMLAttributes<HTMLInputElement>) => (
  <input className={cn('h-8 rounded-md border bg-card px-2.5 text-sm outline-none focus:ring-2 focus:ring-primary/20', className)} {...p} />
);
export const Select = ({ className, ...p }: SelectHTMLAttributes<HTMLSelectElement>) => (
  <select className={cn('h-8 rounded-md border bg-card px-2 text-sm outline-none', className)} {...p} />
);
