import { cva, type VariantProps } from 'class-variance-authority';
import type { ButtonHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

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
