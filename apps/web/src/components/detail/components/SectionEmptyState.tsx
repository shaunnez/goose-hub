import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

interface SectionEmptyStateProps {
  icon?: LucideIcon;
  title: string;
  subtitle: ReactNode;
  children?: ReactNode;
  'data-testid'?: string;
}

/**
 * Shared empty-state card used across all detail tab sections.
 * Visual treatment: dashed border, centred icon (optional), heading, subtitle.
 */
export function SectionEmptyState({
  icon: Icon,
  title,
  subtitle,
  children,
  'data-testid': testId,
}: SectionEmptyStateProps) {
  return (
    <div
      data-testid={testId}
      className="rounded-lg border border-dashed border-line bg-bg-elev/20 flex flex-col items-center justify-center gap-3 py-12 px-6 text-center"
    >
      {Icon != null && (
        <div className="w-10 h-10 rounded-full bg-bg-elev flex items-center justify-center">
          <Icon size={20} className="text-fg-2" />
        </div>
      )}
      <div className="flex flex-col gap-1">
        <p className="text-[13px] font-medium text-fg-3">{title}</p>
        <div className="text-[12px] text-fg-2 max-w-xs leading-snug">{subtitle}</div>
      </div>
      {children != null && children}
    </div>
  );
}
