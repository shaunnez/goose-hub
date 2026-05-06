import { fetchEvents } from '@/lib/api';
import type { AgentEventDto } from '@/lib/types';
import { useQuery } from '@tanstack/react-query';
import { Clock, Minus, TrendingDown, TrendingUp } from 'lucide-react';
import { useIssueCostsBreakdown } from '../lib/costs';
import { CostBadge } from './CostBadge';
import { SectionEmptyState } from './SectionEmptyState';

interface RetrospectiveSectionProps {
  projectSlug: string;
  id: string;
}

interface ImprovementCandidate {
  file?: string;
  action?: string;
  evidence?: string;
  confidence?: 'low' | 'medium' | 'high';
  // legacy fields
  kind?: string;
  targetPath?: string;
  suggestionText?: string;
}

interface QualityScore {
  personaId: string;
  score: number;
  trend: 'improving' | 'stable' | 'declining';
  sampleCount?: number;
}

type SummaryShape =
  | string
  | {
      wentWell?: string;
      didNotGoWell?: string;
      architecturalTakeaway?: string;
      couldBeSmootherOrCleanRun?: string;
      mainTakeaway?: string;
    };

interface DecisionSummaryEntry {
  kind: string;
  summary: string;
}

interface LightRetroPayload {
  tier: 'light';
  output: {
    summaryBullets: string[];
    improvementCandidates: ImprovementCandidate[];
    decisionSummaries?: DecisionSummaryEntry[];
    outcome?: string;
    workItemNumber?: number;
  };
}

interface DeepRetroPayload {
  tier: 'deep';
  output: {
    summary?: SummaryShape;
    summaryBullets?: string[];
    personaQualityScores: QualityScore[];
    improvementCandidates: ImprovementCandidate[];
    learningEntries: Array<{
      observation: string;
      rationale: string;
      improvementKind?: string;
      confidence: string;
    }>;
    decisionPatterns: Array<{
      pattern: string;
      frequency?: number;
      occurrences?: number;
      confidence: string;
      note?: string;
    }>;
    decisionSummaries?: DecisionSummaryEntry[];
    outcome?: string;
    workItemNumber?: number;
  };
}

type RetroPayload = LightRetroPayload | DeepRetroPayload;

function TrendIcon({ trend }: { trend: string }) {
  if (trend === 'improving') return <TrendingUp size={13} className="text-green-500" />;
  if (trend === 'declining') return <TrendingDown size={13} className="text-red-400" />;
  return <Minus size={13} className="text-fg-3" />;
}

function CandidateList({ candidates }: { candidates: ImprovementCandidate[] }) {
  if (candidates.length === 0) return null;
  return (
    <div>
      <h3 className="text-[11px] font-medium text-fg-3 uppercase tracking-wider mb-3">
        Improvement Candidates
      </h3>
      <div className="space-y-2">
        {candidates.map((c, i) => {
          const label = c.file ?? c.targetPath;
          const body = c.action ?? c.suggestionText;
          const conf = c.confidence;
          return (
            <div key={label ?? i} className="border border-line rounded-lg p-3 text-[12.5px]">
              <div className="flex items-center gap-2 mb-1">
                {conf && (
                  <span
                    className={`text-[10px] font-medium uppercase px-1.5 py-0.5 rounded ${
                      conf === 'high'
                        ? 'bg-green-500/15 text-green-400'
                        : conf === 'medium'
                          ? 'bg-yellow-500/15 text-yellow-400'
                          : 'bg-blue-500/15 text-blue-400'
                    }`}
                  >
                    {conf}
                  </span>
                )}
                {c.kind && <span className="text-[11px] text-fg-4">{c.kind}</span>}
                {label && (
                  <span className="font-mono text-[10px] text-fg-3 bg-bg-glass px-1 py-0.5 rounded">
                    {label}
                  </span>
                )}
              </div>
              {body && <div className="text-fg-2">{body}</div>}
              {c.evidence && (
                <div className="mt-1.5 text-[11px] text-fg-4 italic">{c.evidence}</div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
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

  let bullets: string[] = [];

  if (retro.tier === 'light') {
    bullets = retro.output.summaryBullets.map((l) => l.replace(/^-\s*/, '').trim()).filter(Boolean);
  } else {
    const s = retro.output.summary;
    if (retro.output.summaryBullets) {
      bullets = retro.output.summaryBullets
        .map((l) => l.replace(/^-\s*/, '').trim())
        .filter(Boolean);
    } else if (typeof s === 'string') {
      bullets = s
        .split('\n')
        .map((l) => l.replace(/^-\s*/, '').trim())
        .filter(Boolean);
    } else if (s != null) {
      bullets = [
        s.wentWell,
        s.didNotGoWell ?? s.couldBeSmootherOrCleanRun,
        s.architecturalTakeaway ?? s.mainTakeaway,
      ].filter((x): x is string => typeof x === 'string' && x.length > 0);
    }
  }
  return (
    <div data-testid="retro-section" className="px-8 py-6 space-y-6">
      {/* Tier badge */}
      <div className="flex items-center gap-2 flex-wrap">
        <span
          className={`text-[10px] font-medium uppercase px-2 py-0.5 rounded-full ${
            retro.tier === 'deep'
              ? 'bg-purple-500/15 text-purple-400'
              : 'bg-blue-500/15 text-blue-400'
          }`}
        >
          {retro.tier} retro
        </span>
        {retroCost && (
          <CostBadge
            tokens={retroCost.tokens}
            usd={retroCost.usd}
            label={retroCost.label}
            size="sm"
          />
        )}
      </div>

      {/* Summary bullets */}
      {bullets.length > 0 && (
        <div>
          <h3 className="text-[11px] font-medium text-fg-3 uppercase tracking-wider mb-3">
            Summary
          </h3>
          <ul className="space-y-1.5">
            {bullets.map((b) => (
              <li key={b} className="flex items-start gap-2 text-[13px] text-fg-2">
                <span className="text-fg-4 mt-0.5">•</span>
                <span>{b}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Deep-only: persona analysis */}
      {retro.tier === 'deep' && retro.output.personaQualityScores.length > 0 && (
        <div>
          <h3 className="text-[11px] font-medium text-fg-3 uppercase tracking-wider mb-3">
            Persona Quality
          </h3>
          <div className="space-y-2">
            {retro.output.personaQualityScores.map((p) => (
              <div
                key={p.personaId}
                className="flex items-center gap-3 border border-line rounded-lg p-3"
              >
                <TrendIcon trend={p.trend} />
                <div className="grow">
                  <span className="text-[12.5px] font-medium font-mono">{p.personaId}</span>
                </div>
                <span className="font-mono text-[12px] text-fg-2">
                  {(p.score * 100).toFixed(0)}%
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Improvement candidates */}
      <CandidateList candidates={retro.output.improvementCandidates} />
    </div>
  );
}
