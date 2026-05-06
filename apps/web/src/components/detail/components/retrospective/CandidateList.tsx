import type { ImprovementCandidate } from '../../lib/retrospective';
import { ConfidenceChip } from './ConfidenceChip';
import { KindChip } from './KindChip';
import { SectionHeader } from './SectionHeader';

export function CandidateList({ candidates }: { candidates: ImprovementCandidate[] }) {
  if (candidates.length === 0) return null;
  return (
    <div data-testid="retro-candidates">
      <SectionHeader title="Improvement Candidates" count={candidates.length} />
      <div className="rounded-lg border border-line bg-bg-elev overflow-hidden">
        {candidates.map((c, i) => (
          <div
            key={`${c.targetPath}-${i}`}
            className={`px-4 py-3 text-[12.5px] ${i === 0 ? '' : 'border-t border-line'}`}
          >
            <div className="flex items-center gap-2 mb-1.5 flex-wrap">
              <ConfidenceChip confidence={c.confidence} />
              <KindChip kind={c.kind} />
              <span className="font-mono text-[10px] text-fg-3 bg-bg-elev-2 px-1.5 py-0.5 rounded truncate max-w-[260px]">
                {c.targetPath}
              </span>
            </div>
            <div className="text-fg-2 leading-relaxed">{c.suggestionText}</div>
            {c.evidence && (
              <div className="mt-1.5 text-[11px] text-fg-2 italic leading-relaxed">
                {c.evidence}
              </div>
            )}
            {c.proposedDiff && (
              <pre className="mt-2 text-[10.5px] font-mono text-fg-3 whitespace-pre-wrap break-all bg-bg rounded px-2 py-1.5 border border-line/60">
                {c.proposedDiff}
              </pre>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
