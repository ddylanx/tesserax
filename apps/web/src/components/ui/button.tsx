import { cva, type VariantProps } from 'class-variance-authority';
import type { ButtonHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

/** The one focus ring for controls (accent, keyboard focus only). */
export const focusRing = 'outline-none focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-offset-1 focus-visible:ring-offset-background';

const primary = 'bg-primary text-primary-foreground shadow-xs hover:bg-primary/90';
const secondary = 'border bg-card shadow-xs hover:bg-accent';

const button = cva(
  `inline-flex items-center justify-center gap-1.5 rounded-md text-sm font-medium transition-colors disabled:opacity-50 disabled:pointer-events-none ${focusRing}`,
  {
    variants: {
      variant: {
        primary,
        secondary,
        ghost: 'hover:bg-accent',
        destructive: 'bg-destructive text-destructive-foreground shadow-xs hover:bg-destructive/90',
        // older names, same looks
        default: primary,
        outline: secondary,
      },
      size: { default: 'h-8 px-3', sm: 'h-7 px-2 text-xs', icon: 'size-8', 'icon-sm': 'size-7' },
    },
    defaultVariants: { variant: 'primary', size: 'default' },
  },
);

export const Button = ({ className, variant, size, ...p }: ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof button>) => (
  <button className={cn(button({ variant, size }), className)} {...p} />
);
