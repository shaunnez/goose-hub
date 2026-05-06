import type { DecisionSummaryEntry } from '../../lib/retrospective';
import { KindChip } from './KindChip';
import { SectionHeader } from './SectionHeader';

export function DecisionSummariesSection({ summaries }: { summaries: DecisionSummaryEntry[] }) {
  if (summaries.length === 0) return null;
  return (
    <div data-testid="retro-decisions">
      <SectionHeader title="Decision Summaries" count={summaries.length} />
      <div className="rounded-lg border border-line bg-bg-elev overflow-hidden">
        {summaries.map((d, i) => (
          <div
            key={`${d.kind}-${i}`}
            className={`px-4 py-3 text-[12.5px] ${i === 0 ? '' : 'border-t border-line'}`}
          >
            <div className="flex items-center gap-2 mb-1.5 flex-wrap">
              <KindChip kind={d.kind} />
            </div>
            <div className="text-fg-2 leading-relaxed">{d.summary}</div>
            {d.evidence && (
              <div className="mt-1.5 text-[11px] text-fg-2 italic leading-relaxed">
                {d.evidence}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
