import type { LearningEntry } from '../../lib/retrospective';
import { ConfidenceChip } from './ConfidenceChip';
import { KindChip } from './KindChip';
import { SectionHeader } from './SectionHeader';

export function LearningEntriesSection({ entries }: { entries: LearningEntry[] }) {
  if (entries.length === 0) return null;
  return (
    <div data-testid="retro-learnings">
      <SectionHeader title="Learning Entries" count={entries.length} />
      <div className="rounded-lg border border-line bg-bg-elev overflow-hidden">
        {entries.map((e, i) => (
          <div
            key={`${e.observation}-${i}`}
            className={`px-4 py-3 text-[12.5px] ${i === 0 ? '' : 'border-t border-line'}`}
          >
            <div className="flex items-center gap-2 mb-1.5 flex-wrap">
              <ConfidenceChip confidence={e.confidence} />
              <KindChip kind={e.improvementKind} />
              {e.targetPath && (
                <span className="font-mono text-[10px] text-fg-3 bg-bg-elev-2 px-1.5 py-0.5 rounded truncate max-w-[220px]">
                  {e.targetPath}
                </span>
              )}
            </div>
            <div className="text-fg-2 leading-relaxed">{e.observation}</div>
            <div className="mt-1.5 text-[11px] text-fg-2 italic leading-relaxed">{e.rationale}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
