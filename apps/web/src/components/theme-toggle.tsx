import { Monitor, Moon, Sun } from 'lucide-react';
import { useTheme, type ThemePref } from '@/lib/theme';
import { cn } from '@/lib/utils';

const options: { value: ThemePref; label: string; icon: typeof Sun }[] = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'System', icon: Monitor },
];

export function ThemeToggle({ className }: { className?: string }) {
  const { pref, setPref } = useTheme();
  return (
    <div role="radiogroup" aria-label="Theme" className={cn('inline-flex items-center gap-0.5 rounded-md border bg-muted p-0.5', className)}>
      {options.map(({ value, label, icon: Icon }) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={pref === value}
          title={`${label} theme`}
          onClick={() => setPref(value)}
          className={cn(
            'inline-flex size-6 items-center justify-center rounded text-muted-foreground transition-colors hover:text-foreground',
            pref === value && 'bg-card text-foreground shadow-xs',
          )}
        >
          <Icon className="size-3.5" />
          <span className="sr-only">{label}</span>
        </button>
      ))}
    </div>
  );
}
