import { cn } from '@/lib/cn';
import type { HTMLAttributes, ReactNode } from 'react';

type Tone = 'default' | 'accent' | 'success' | 'warning' | 'danger' | 'info';

interface PillProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: Tone;
  children: ReactNode;
}

const TONE_CLASSES: Record<Tone, string> = {
  default: 'bg-bg-elev border border-line text-fg-2',
  accent: 'bg-accent-soft border border-accent-line text-fg',
  success:
    'bg-[color:var(--success)]/15 border border-[color:var(--success)]/40 text-[color:var(--success)]',
  warning:
    'bg-[color:var(--warning)]/15 border border-[color:var(--warning)]/40 text-[color:var(--warning)]',
  danger:
    'bg-[color:var(--danger)]/15 border border-[color:var(--danger)]/40 text-[color:var(--danger)]',
  info: 'bg-[color:var(--info)]/15 border border-[color:var(--info)]/40 text-[color:var(--info)]',
};

export function Pill({ tone = 'default', className, children, ...rest }: PillProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 h-6 px-2 rounded-full text-[11.5px] truncate',
        TONE_CLASSES[tone],
        className,
      )}
      {...rest}
    >
      {children}
    </span>
  );
}
