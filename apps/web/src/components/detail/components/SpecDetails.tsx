import type { EngineeringSpecDto } from '@/lib/types';
import { ClipboardCheck, Package } from 'lucide-react';
import { DetailAccordionSection } from './AcceptanceContractDetails';

const DEV_OR_LATER_STATES = new Set([
  'factory:dev-ready',
  'factory:spec-ready',
  'factory:in-progress',
  'factory:needs-qa',
  'factory:qa-failed',
  'factory:needs-review',
  'factory:needs-fix',
  'factory:approved',
  'factory:merge-conflict',
  'factory:retrospecting',
  'factory:done',
]);

export function SpecDetails({
  spec,
  itemState,
}: {
  spec: EngineeringSpecDto;
  itemState?: string;
}) {
  if (!DEV_OR_LATER_STATES.has(itemState ?? '')) return null;

  const wpCount = spec.workPackages.length;

  return (
    <DetailAccordionSection
      icon={Package}
      sectionTestId="engineering-spec-section"
      subtitle={`${wpCount} work package${wpCount !== 1 ? 's' : ''} · ${spec.acceptanceCriteriaCount} AC`}
      title="Engineering Spec"
    >
      <div className="flex flex-col gap-4 py-1">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-fg-3 mb-1">Objective</div>
          <p className="text-[12.5px] text-fg-2 leading-relaxed">{spec.objective}</p>
        </div>

        <div>
          <div className="text-[10px] uppercase tracking-wider text-fg-3 mb-2">Work packages</div>
          <div className="rounded border border-line overflow-hidden">
            <table className="w-full text-[11.5px]">
              <thead>
                <tr className="border-b border-line bg-bg-elev-2">
                  <th className="px-3 py-2 text-left text-fg-3 font-medium w-20">ID</th>
                  <th className="px-3 py-2 text-left text-fg-3 font-medium">Files owned</th>
                  <th className="px-3 py-2 text-left text-fg-3 font-medium w-20">Tier</th>
                </tr>
              </thead>
              <tbody>
                {spec.workPackages.map((wp) => (
                  <tr key={wp.id} className="border-b border-line last:border-0">
                    <td className="px-3 py-2 font-mono text-fg-2 whitespace-nowrap">{wp.id}</td>
                    <td className="px-3 py-2">
                      {wp.filesOwned.map((f) => (
                        <div key={f} className="font-mono text-[10.5px] text-fg-4 truncate">
                          {f}
                        </div>
                      ))}
                    </td>
                    <td className="px-3 py-2 font-mono text-fg-4 whitespace-nowrap">
                      {wp.builderTier}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div>
          <div className="flex items-center gap-2 text-[11.5px] text-fg-3 mb-2">
            <ClipboardCheck size={12} className="text-fg-4 shrink-0" />
            <span>{spec.acceptanceCriteriaCount} acceptance criteria</span>
          </div>
          {spec.acceptanceCriteria.length > 0 && (
            <ol className="flex flex-col gap-2">
              {spec.acceptanceCriteria.map((ac) => (
                <li key={ac.id} className="grid grid-cols-[3.5rem_1fr] gap-3 text-[12px] text-fg-2">
                  <span className="font-mono text-[11px] text-fg-4">{ac.id}</span>
                  <div className="min-w-0">
                    <div className="leading-relaxed">{ac.statement}</div>
                    {ac.verifyCommand != null && (
                      <div className="mt-1 font-mono text-[10.5px] text-fg-4 break-words">
                        {ac.verifyCommand}
                      </div>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>
    </DetailAccordionSection>
  );
}
