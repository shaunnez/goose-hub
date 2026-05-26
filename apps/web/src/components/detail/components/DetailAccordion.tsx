import { ChevronDown, ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';
import { useId, useState } from 'react';

export interface DetailAccordionProps {
  title: string;
  summary?: string;
  icon?: ReactNode;
  defaultOpen?: boolean;
  testId?: string;
  contentTestId?: string;
  children: ReactNode;
}

export function DetailAccordion({
  title,
  summary,
  icon,
  defaultOpen = false,
  testId,
  contentTestId,
  children,
}: DetailAccordionProps): JSX.Element {
  const [open, setOpen] = useState(defaultOpen);
  const contentId = useId();

  return (
    <div
      className="rounded-lg border border-[color:var(--accent)]/20 bg-bg-elev overflow-hidden"
      data-testid={testId}
    >
      <button
        type="button"
        aria-controls={contentId}
        aria-expanded={open}
        onClick={() => setOpen((currentOpen) => !currentOpen)}
        className="w-full flex items-center justify-between gap-3 px-4 py-3 bg-bg-elev-2 text-left cursor-pointer"
      >
        <div className="flex min-w-0 items-center gap-2">
          {icon != null ? (
            <span className="shrink-0 text-[color:var(--accent)]">{icon}</span>
          ) : null}
          <span className="text-[10.5px] uppercase tracking-wider text-fg-2 shrink-0">{title}</span>
          {summary != null ? (
            <span className="text-[11px] text-fg-4 truncate">{summary}</span>
          ) : null}
        </div>
        <span className="shrink-0 text-fg-4">
          {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </span>
      </button>

      {open ? (
        <div
          id={contentId}
          data-testid={contentTestId}
          className="px-4 py-4 flex flex-col gap-4 border-t border-line"
        >
          {children}
        </div>
      ) : null}
    </div>
  );
}
