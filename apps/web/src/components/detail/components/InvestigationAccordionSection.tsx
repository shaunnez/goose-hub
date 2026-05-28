import { ChevronDown, ChevronRight } from 'lucide-react';
import { useState } from 'react';

export interface InvestigationAccordionSectionProps {
  title: string;
  summary?: string;
  icon: JSX.Element;
  defaultOpen?: boolean;
  testId: string;
  children: React.ReactNode;
}

export function InvestigationAccordionSection({
  title,
  summary,
  icon,
  defaultOpen = false,
  testId,
  children,
}: InvestigationAccordionSectionProps): JSX.Element {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div
      data-testid={testId}
      className="rounded-lg border border-[color:var(--accent)]/20 bg-bg-elev overflow-hidden"
    >
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="w-full flex items-center justify-between px-4 py-3 bg-bg-elev-2 text-left cursor-pointer"
      >
        <div className="flex items-center gap-2 min-w-0">
          <span className="shrink-0 text-[color:var(--accent)]">{icon}</span>
          <span className="text-[10.5px] uppercase tracking-wider text-fg-2 shrink-0">{title}</span>
          {summary != null && summary.length > 0 && (
            <span className="text-[11px] text-fg-4 truncate">{summary}</span>
          )}
        </div>
        <span className="shrink-0 text-fg-4">
          {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </span>
      </button>
      {open && <div className="px-4 py-4 flex flex-col gap-4 border-t border-line">{children}</div>}
    </div>
  );
}
