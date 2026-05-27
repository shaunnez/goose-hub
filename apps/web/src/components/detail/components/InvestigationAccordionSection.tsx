import { ChevronDown, ChevronRight } from 'lucide-react';
import { type ComponentType, type ReactNode, useEffect, useRef, useState } from 'react';

export interface InvestigationAccordionSectionProps {
  title: string;
  defaultOpen?: boolean;
  resetKey?: string;
  badge?: ReactNode;
  icon?: ComponentType<{ size?: number; className?: string }>;
  children: ReactNode;
  testId?: string;
  contentTestId?: string;
}

export function InvestigationAccordionSection({
  title,
  defaultOpen = false,
  resetKey,
  badge,
  icon: Icon,
  children,
  testId,
  contentTestId,
}: InvestigationAccordionSectionProps): JSX.Element {
  const [open, setOpen] = useState(defaultOpen);
  const identity = resetKey ?? title;
  const previousIdentity = useRef(identity);

  useEffect(() => {
    if (previousIdentity.current !== identity) {
      previousIdentity.current = identity;
      setOpen(defaultOpen);
    }
  }, [defaultOpen, identity]);

  return (
    <div
      className="rounded-lg border border-[color:var(--accent)]/20 bg-bg-elev overflow-hidden"
      data-testid={testId}
    >
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        className="w-full flex items-center justify-between px-4 py-3 bg-bg-elev-2 text-left cursor-pointer"
      >
        <div className="flex items-center gap-2 min-w-0">
          {Icon != null && <Icon size={12} className="shrink-0 text-[color:var(--accent)]" />}
          <span className="text-[10.5px] uppercase tracking-wider text-fg-2 shrink-0">{title}</span>
          {badge != null && <span className="text-[11px] text-fg-4 truncate">{badge}</span>}
        </div>
        <span className="shrink-0 text-fg-4">
          {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </span>
      </button>

      {open && (
        <div
          className="px-4 py-4 flex flex-col gap-4 border-t border-line"
          data-testid={contentTestId}
        >
          {children}
        </div>
      )}
    </div>
  );
}
