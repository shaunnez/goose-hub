import { cn } from '@/lib/cn';
import { type ButtonHTMLAttributes, forwardRef } from 'react';

type Variant = 'default' | 'ghost' | 'primary' | 'danger';
type Size = 'sm' | 'md';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

const VARIANTS: Record<Variant, string> = {
  default:
    'bg-bg-elev hover:bg-bg-hover border border-line text-fg disabled:opacity-50 disabled:cursor-not-allowed',
  ghost:
    'hover:bg-bg-hover text-fg-2 hover:text-fg disabled:opacity-50 disabled:cursor-not-allowed',
  primary:
    'bg-accent hover:brightness-110 text-[color:var(--accent-fg)] font-medium disabled:opacity-50 disabled:cursor-not-allowed',
  danger:
    'bg-bg-elev hover:bg-bg-hover border border-[color:var(--danger)]/40 text-[color:var(--danger)]',
};

const SIZES: Record<Size, string> = {
  sm: 'h-7 px-2 text-[12.5px] gap-1.5 rounded-[5px]',
  md: 'h-9 px-3 text-[13.5px] gap-2 rounded-[6px]',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'default', size = 'md', ...rest }, ref) => (
    <button
      ref={ref}
      type={rest.type ?? 'button'}
      className={cn(
        'inline-flex items-center justify-center transition-colors',
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...rest}
    />
  ),
);
Button.displayName = 'Button';
