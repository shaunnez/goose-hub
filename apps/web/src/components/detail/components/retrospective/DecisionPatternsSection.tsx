import type { DecisionPattern } from '../../lib/retrospective';
import { ConfidenceChip } from './ConfidenceChip';
import { SectionHeader } from './SectionHeader';

export function DecisionPatternsSection({ patterns }: { patterns: DecisionPattern[] }) {
  if (patterns.length === 0) return null;
  return (
    <div data-testid="retro-patterns">
      <SectionHeader title="Decision Patterns" count={patterns.length} />
      <div className="rounded-lg border border-line bg-bg-elev overflow-hidden">
        {patterns.map((p, i) => (
          <div
            key={`${p.pattern}-${i}`}
            className={`px-4 py-3 text-[12.5px] ${i === 0 ? '' : 'border-t border-line'}`}
          >
            <div className="flex items-center gap-2 mb-1.5 flex-wrap">
              <ConfidenceChip confidence={p.confidence} />
              <span className="text-[11px] text-fg-2 font-mono tnum">
                {p.occurrences}× recurring
              </span>
            </div>
            <div className="text-fg-2 leading-relaxed">{p.pattern}</div>
            {p.note && (
              <div className="mt-1.5 text-[11px] text-fg-2 italic leading-relaxed">{p.note}</div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
