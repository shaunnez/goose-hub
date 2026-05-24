import { cn } from '@/lib/cn';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { type ReactNode, useId, useState } from 'react';

export interface SectionAccordionProps {
  title: string;
  children: ReactNode;
  defaultOpen?: boolean;
  summary?: ReactNode;
  icon?: ReactNode;
  testId?: string;
  headerTestId?: string;
  contentTestId?: string;
  className?: string;
  contentClassName?: string;
}

export function SectionAccordion({
  title,
  children,
  defaultOpen = false,
  summary,
  icon,
  testId,
  headerTestId,
  contentTestId,
  className,
  contentClassName,
}: SectionAccordionProps) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  const buttonId = `${id}-button`;
  const panelId = `${id}-panel`;

  return (
    <section
      data-testid={testId}
      className={cn(
        'rounded-lg border border-[color:var(--accent)]/20 bg-bg-elev overflow-hidden',
        className,
      )}
    >
      <h3>
        <button
          id={buttonId}
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          data-testid={headerTestId ?? (testId != null ? `${testId}-toggle` : undefined)}
          onClick={() => setOpen((current) => !current)}
          className="flex w-full items-center justify-between gap-3 bg-bg-elev-2 px-4 py-3 text-left cursor-pointer"
        >
          <span className="flex min-w-0 items-center gap-2">
            <span className="shrink-0 text-fg-4">
              {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            </span>
            {icon != null && <span className="shrink-0 text-[color:var(--accent)]">{icon}</span>}
            <span className="shrink-0 text-[10.5px] uppercase tracking-wider text-fg-2">
              {title}
            </span>
            {summary != null && <span className="truncate text-[11px] text-fg-4">{summary}</span>}
          </span>
        </button>
      </h3>

      {open && (
        <section
          id={panelId}
          aria-labelledby={buttonId}
          data-testid={contentTestId ?? (testId != null ? `${testId}-content` : undefined)}
          className={cn('border-t border-line px-4 py-4', contentClassName)}
        >
          {children}
        </section>
      )}
    </section>
  );
}
