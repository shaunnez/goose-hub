import type { AcceptanceContractDto } from '@/lib/types';
import { ChevronDown, ChevronRight, ClipboardCheck, Terminal } from 'lucide-react';
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
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="w-full flex items-center justify-between px-4 py-3 bg-bg-elev-2 text-left cursor-pointer"
      >
        <div className="flex items-center gap-2 min-w-0">
          <ClipboardCheck size={13} className="shrink-0 text-[color:var(--accent)]" />
          <span className="text-[10.5px] uppercase tracking-wider text-fg-2 shrink-0">
            Acceptance Contract
          </span>
          <span className="text-[11px] text-fg-4 truncate">
            {SOURCE_LABEL[contract.source]} · {contract.criteria.length} AC
          </span>
        </div>
        <span className="shrink-0 text-fg-4">
          {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </span>
      </button>
      {open && (
        <ol className="px-4 py-3 flex flex-col gap-3 border-t border-line">
          {contract.criteria.map((criterion) => (
            <li key={criterion.id} className="grid grid-cols-[3.5rem_1fr] gap-3 text-[12.5px]">
              <span className="font-mono text-[11px] text-fg-3">{criterion.id}</span>
              <div className="min-w-0">
                <div className="text-fg-2 leading-relaxed">{criterion.statement}</div>
                {(criterion.executableChecks?.length ?? 0) > 0 && (
                  <div className="mt-2 flex flex-col gap-1.5">
                    {criterion.executableChecks?.map((check) => (
                      <div
                        key={check.id}
                        className="flex items-start gap-2 rounded border border-line bg-bg-elev-2 px-2 py-1.5"
                      >
                        <Terminal size={11} className="mt-0.5 shrink-0 text-fg-4" />
                        <div className="min-w-0">
                          <div className="font-mono text-[11px] text-fg-3 break-words">
                            {check.command}
                          </div>
                          <div className="mt-0.5 text-[10.5px] text-fg-4">
                            {(check.kind ?? 'custom').toUpperCase()} · exit{' '}
                            {(check.expectedExitCodes ?? [0]).join(', ')}
                          </div>
                        </div>
                      </div>
                    ))}
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
