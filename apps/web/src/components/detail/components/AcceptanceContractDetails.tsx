import type { AcceptanceContractDto } from '@/lib/types';
import { ChevronDown, ChevronRight, ClipboardCheck, type LucideIcon } from 'lucide-react';
import { type ReactNode, useState } from 'react';

const SOURCE_LABEL: Record<AcceptanceContractDto['source'], string> = {
  normalized: 'Normalized',
  'engineering-spec': 'Engineering spec',
  prd: 'PRD',
  'issue-body': 'Issue body',
};

export function DetailAccordionSection({
  children,
  defaultOpen = false,
  icon: Icon,
  sectionTestId,
  subtitle,
  title,
}: {
  children: ReactNode;
  defaultOpen?: boolean;
  icon?: LucideIcon;
  sectionTestId?: string;
  subtitle?: ReactNode;
  title: string;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div
      data-testid={sectionTestId}
      className="rounded-lg border border-[color:var(--accent)]/20 bg-bg-elev overflow-hidden"
    >
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className="w-full flex items-center justify-between gap-3 px-4 py-3 bg-bg-elev-2 text-left cursor-pointer"
      >
        <div className="flex min-w-0 items-center gap-2">
          {Icon != null && <Icon size={13} className="shrink-0 text-[color:var(--accent)]" />}
          <span className="text-[10.5px] uppercase tracking-wider text-fg-2">{title}</span>
          {subtitle != null && <span className="text-[11px] text-fg-4">{subtitle}</span>}
        </div>
        <span className="shrink-0 text-fg-4">
          {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </span>
      </button>
      {open && <div className="px-4 py-3 border-t border-line">{children}</div>}
    </div>
  );
}

export function AcceptanceContractDetails({
  contract,
}: {
  contract: AcceptanceContractDto | null | undefined;
}) {
  if (contract == null || contract.criteria.length === 0) return null;

  return (
    <DetailAccordionSection
      icon={ClipboardCheck}
      sectionTestId="acceptance-contract-section"
      subtitle={`${SOURCE_LABEL[contract.source]} · ${contract.criteria.length} AC`}
      title="Acceptance Contract"
    >
      <ol className="flex flex-col gap-3">
        {contract.criteria.map((criterion) => (
          <li key={criterion.id} className="grid grid-cols-[3.5rem_1fr] gap-3 text-[12.5px]">
            <span className="font-mono text-[11px] text-fg-3">{criterion.id}</span>
            <div className="min-w-0">
              <div className="text-fg-2 leading-relaxed">{criterion.statement}</div>
              {criterion.verifyCommand != null && (
                <div className="mt-1 font-mono text-[11px] text-fg-4 break-words">
                  {criterion.verifyCommand}
                </div>
              )}
            </div>
          </li>
        ))}
      </ol>
    </DetailAccordionSection>
  );
}
