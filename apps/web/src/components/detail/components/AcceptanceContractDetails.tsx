import type { AcceptanceContractDto } from '@/lib/types';
import { ClipboardCheck, Terminal } from 'lucide-react';
import { InvestigationAccordionSection } from './InvestigationAccordionSection';

const SOURCE_LABEL: Record<AcceptanceContractDto['source'], string> = {
  normalized: 'Normalized',
  'engineering-spec': 'Engineering spec',
  prd: 'PRD',
  'issue-body': 'Issue body',
};

export function AcceptanceContractDetails({
  contract,
  defaultOpen = false,
}: {
  contract: AcceptanceContractDto | null | undefined;
  defaultOpen?: boolean;
}) {
  if (contract == null || contract.criteria.length === 0) return null;

  return (
    <InvestigationAccordionSection
      title="Acceptance Criteria"
      icon={ClipboardCheck}
      defaultOpen={defaultOpen}
      badge={`${SOURCE_LABEL[contract.source]} · ${contract.criteria.length} AC`}
      contentTestId="acceptance-contract-content"
    >
      <ol className="flex flex-col gap-3">
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
    </InvestigationAccordionSection>
  );
}
