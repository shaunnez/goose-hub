import type { AcceptanceContractDto } from '@/lib/types';
import { ChevronDown, ChevronRight, ClipboardCheck } from 'lucide-react';
import { useState } from 'react';

const SOURCE_LABEL: Record<AcceptanceContractDto['source'], string> = {
  normalized: 'Normalized',
  'engineering-spec': 'Engineering spec',
  prd: 'PRD',
  'issue-body': 'Issue body',
};

export function AcceptanceContractDetails({
  contract,
}: {
  contract: AcceptanceContractDto | null | undefined;
}) {
  const [open, setOpen] = useState(false);

  if (contract == null || contract.criteria.length === 0) return null;

  return (
    <div className="rounded-lg border border-[color:var(--accent)]/20 bg-bg-elev overflow-hidden">
      <button
        type="button"
        data-testid="acceptance-contract-trigger"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className="w-full flex items-center justify-between px-4 py-3 bg-bg-elev-2 text-left cursor-pointer"
      >
        <div className="flex items-center gap-2 min-w-0">
          <ClipboardCheck size={13} className="shrink-0 text-[color:var(--accent)]" />
          <span className="text-[10.5px] uppercase tracking-wider text-fg-2">
            Acceptance Contract
          </span>
          <span className="text-[11px] text-fg-4">
            {SOURCE_LABEL[contract.source]} · {contract.criteria.length} AC
          </span>
        </div>
        <span className="shrink-0 text-fg-4">
          {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </span>
      </button>
      {open && (
        <ol
          data-testid="acceptance-contract-content"
          className="px-4 py-3 flex flex-col gap-3 border-t border-line"
        >
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
      )}
    </div>
  );
}
