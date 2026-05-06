import { getPersonaLabel, usePersonaMap } from '@/lib/usePersonaMap';
import { type QualityScore, scoreGrade } from '../../lib/retrospective';
import { SectionHeader } from './SectionHeader';
import { TrendIcon } from './TrendIcon';

export function PersonaScoresSection({ scores }: { scores: QualityScore[] }) {
  const personaMap = usePersonaMap();
  if (scores.length === 0) return null;
  return (
    <div data-testid="retro-personas">
      <SectionHeader title="Persona Quality" count={scores.length} />
      <div className="rounded-lg border border-line bg-bg-elev overflow-hidden">
        {scores.map((p, i) => {
          const label = getPersonaLabel(personaMap, p.personaId) ?? p.personaId;
          const grade = scoreGrade(p.score);
          const pct = Math.round(p.score * 100);
          return (
            <div key={p.personaId} className={`px-4 py-3 ${i === 0 ? '' : 'border-t border-line'}`}>
              <div className="flex items-center gap-3 mb-1.5">
                <TrendIcon trend={p.trend} />
                <span className="text-[12.5px] font-medium font-mono text-fg-2 truncate flex-1">
                  {label}
                </span>
                <span
                  className="text-[10.5px] font-semibold uppercase tracking-wide"
                  style={{ color: grade.color }}
                >
                  {grade.label}
                </span>
                <span className="text-[12px] font-mono text-fg-2 tnum w-9 text-right">{pct}%</span>
              </div>
              <div className="h-1 rounded-full bg-bg-elev-2 overflow-hidden">
                <div
                  className="h-full rounded-full transition-all"
                  style={{ width: `${pct}%`, backgroundColor: grade.color }}
                />
              </div>
              {p.rationale && (
                <div className="mt-2 text-[11.5px] text-fg-3 leading-relaxed">{p.rationale}</div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
