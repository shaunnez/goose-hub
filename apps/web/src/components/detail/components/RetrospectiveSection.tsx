import { fetchEvents } from '@/lib/api';
import type { AgentEventDto } from '@/lib/types';
import { useQuery } from '@tanstack/react-query';
import { Clock } from 'lucide-react';
import { useIssueCostsBreakdown } from '../lib/costs';
import {
  type DeepRetroPayload,
  type RetroPayload,
  outcomeMeta,
  scoreGrade,
} from '../lib/retrospective';
import { CostBadge } from './CostBadge';
import { SectionEmptyState } from './SectionEmptyState';
import { StatCard } from './StatCard';
import { CandidateList } from './retrospective/CandidateList';
import { DecisionPatternsSection } from './retrospective/DecisionPatternsSection';
import { DecisionSummariesSection } from './retrospective/DecisionSummariesSection';
import { LearningEntriesSection } from './retrospective/LearningEntriesSection';
import { PersonaScoresSection } from './retrospective/PersonaScoresSection';
import { SummarySection } from './retrospective/SummarySection';

interface RetrospectiveSectionProps {
  projectSlug: string;
  id: string;
}

export function RetrospectiveSection({ projectSlug, id }: RetrospectiveSectionProps) {
  const { data: events = [], isLoading } = useQuery<AgentEventDto[]>({
    queryKey: ['events', projectSlug, id],
    queryFn: () => fetchEvents(projectSlug, id),
  });
  const { byStage } = useIssueCostsBreakdown(projectSlug, id);
  const retroCost = byStage.get('retrospective');

  if (isLoading) return null;

  const retroEvent = [...events].find((e) => e.kind === 'retrospective.completed');
  const retro = retroEvent?.payload as RetroPayload | undefined;
  if (!retro) {
    return (
      <div className="px-8 py-6">
        <div className="text-[10.5px] uppercase tracking-wider text-fg-2 mb-1">
          09 · Retrospective
        </div>
        <div className="flex items-center gap-2 flex-wrap mb-5">
          <h2 className="text-[17px] font-semibold text-fg leading-snug">
            Deep or light retrospective
          </h2>
        </div>
        <SectionEmptyState
          data-testid="retro-empty-state"
          icon={Clock}
          title="No retrospective yet."
          subtitle={
            <>
              Runs automatically after the PR merges to{' '}
              <code className="font-mono">factory:done</code>.
            </>
          }
        />
      </div>
    );
  }

  const isDeep = retro.tier === 'deep';
  const out = retro.output;
  const outcome = outcomeMeta(out.outcome);
  const OutcomeIcon = outcome.icon;

  const triggerReasons = isDeep ? (retro as DeepRetroPayload).output.triggerReasons : [];
  const personaScores = isDeep ? (retro as DeepRetroPayload).output.personaQualityScores : [];
  const learningEntries = isDeep ? (retro as DeepRetroPayload).output.learningEntries : [];
  const decisionPatterns = isDeep ? (retro as DeepRetroPayload).output.decisionPatterns : [];

  const avgPersonaScore =
    personaScores.length > 0
      ? personaScores.reduce((sum, p) => sum + p.score, 0) / personaScores.length
      : null;
  const avgPct = avgPersonaScore != null ? Math.round(avgPersonaScore * 100) : null;
  const avgGrade = avgPersonaScore != null ? scoreGrade(avgPersonaScore) : null;

  const highCandidates = out.improvementCandidates.filter((c) => c.confidence === 'high').length;
  const totalCandidates = out.improvementCandidates.length;

  const detailCards = [
    { key: 'summary', node: <SummarySection summary={out.summary} /> },
    ...(isDeep && personaScores.length > 0
      ? [{ key: 'personas', node: <PersonaScoresSection scores={personaScores} /> }]
      : []),
    ...(out.improvementCandidates.length > 0
      ? [{ key: 'candidates', node: <CandidateList candidates={out.improvementCandidates} /> }]
      : []),
    ...(isDeep && learningEntries.length > 0
      ? [{ key: 'learnings', node: <LearningEntriesSection entries={learningEntries} /> }]
      : []),
    ...(isDeep && decisionPatterns.length > 0
      ? [{ key: 'patterns', node: <DecisionPatternsSection patterns={decisionPatterns} /> }]
      : []),
    ...(out.decisionSummaries.length > 0
      ? [{ key: 'decisions', node: <DecisionSummariesSection summaries={out.decisionSummaries} /> }]
      : []),
  ];

  return (
    <div data-testid="retro-section" className="px-8 py-6 flex flex-col gap-5">
      {/* Section header */}
      <div className="flex items-end gap-3 flex-wrap">
        <div className="flex-1 min-w-0">
          <div className="text-[10.5px] uppercase tracking-wider text-fg-2 mb-1">
            09 · Retrospective
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-[17px] font-semibold text-fg leading-snug">
              {isDeep ? 'Deep retrospective' : 'Light retrospective'}
            </h2>
            {isDeep && triggerReasons.length > 0 && (
              <div className="flex items-center gap-1.5 flex-wrap">
                {triggerReasons.map((r) => (
                  <span
                    key={r}
                    className="text-[10.5px] px-1.5 py-0.5 rounded-full border border-line bg-bg-elev text-fg-3 font-mono"
                  >
                    {r}
                  </span>
                ))}
              </div>
            )}
          </div>
          <div className="flex items-center gap-2 text-[12.5px] text-fg-3 mt-1 flex-wrap">
            <OutcomeIcon size={13} style={{ color: outcome.color }} />
            <span style={{ color: outcome.color, textTransform: 'uppercase', fontWeight: 600 }}>
              {outcome.label}
            </span>
            <span className="text-fg-2">·</span>
            <span>
              {totalCandidates} candidate{totalCandidates === 1 ? '' : 's'}
            </span>
            {isDeep && (
              <>
                <span className="text-fg-2">·</span>
                <span>
                  {personaScores.length} persona{personaScores.length === 1 ? '' : 's'} scored
                </span>
              </>
            )}
            {retroCost && (
              <>
                <span className="text-fg-2">·</span>
                <CostBadge
                  tokens={retroCost.tokens}
                  usd={retroCost.usd}
                  label={retroCost.label}
                  size="sm"
                />
              </>
            )}
          </div>
        </div>
      </div>

      {/* Stat row */}
      <div className="grid grid-cols-4 gap-3">
        <StatCard
          label="Outcome"
          value={outcome.label}
          sub={`work item #${out.workItemNumber}`}
          color={outcome.color}
        />
        <StatCard
          label="High-confidence"
          value={`${highCandidates} / ${totalCandidates}`}
          sub={totalCandidates === 0 ? 'no candidates' : 'improvement candidates'}
          color={highCandidates > 0 ? 'var(--accent)' : undefined}
        />
        {isDeep ? (
          <StatCard
            label="Avg quality"
            value={avgPct != null ? `${avgPct}%` : '—'}
            sub={avgGrade?.label ?? 'no personas'}
            color={avgGrade?.color}
          />
        ) : (
          <StatCard label="Avg quality" value="—" sub="deep retro only" />
        )}
        {isDeep ? (
          <StatCard
            label="Patterns / Learnings"
            value={`${decisionPatterns.length} / ${learningEntries.length}`}
            sub={
              decisionPatterns.length + learningEntries.length === 0
                ? 'none recorded'
                : 'recurring · generalizable'
            }
          />
        ) : (
          <StatCard
            label="Decisions"
            value={`${out.decisionSummaries.length}`}
            sub="summary points"
          />
        )}
      </div>

      <div className="columns-1 xl:columns-2 gap-5 [column-fill:balance]">
        {detailCards.map((card) => (
          <div key={card.key} className="mb-5 break-inside-avoid last:mb-0">
            {card.node}
          </div>
        ))}
      </div>
    </div>
  );
}
