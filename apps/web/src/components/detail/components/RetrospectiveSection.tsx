import { fetchEvents } from '@/lib/api';
import type { AgentEventDto } from '@/lib/types';
import { getPersonaLabel, usePersonaMap } from '@/lib/usePersonaMap';
import { useQuery } from '@tanstack/react-query';
import {
  AlertCircle,
  CheckCircle,
  Clock,
  Minus,
  RefreshCw,
  TrendingDown,
  TrendingUp,
  XCircle,
} from 'lucide-react';
import { useIssueCostsBreakdown } from '../lib/costs';
import { CostBadge } from './CostBadge';
import { SectionEmptyState } from './SectionEmptyState';
import { StatCard } from './StatCard';

interface RetrospectiveSectionProps {
  projectSlug: string;
  id: string;
}

type Confidence = 'low' | 'medium' | 'high';
type Outcome = 'success' | 'failure' | 'partial';
type ImprovementKind =
  | 'skill-prompt'
  | 'skill-schema'
  | 'skill-config'
  | 'global-config'
  | 'project-config'
  | 'persona'
  | 'workflow'
  | 'governance-suggestion';

interface Summary {
  wentWell: string;
  didNotGoWell: string;
  architecturalTakeaway: string;
}

interface ImprovementCandidate {
  kind: ImprovementKind;
  targetPath: string;
  suggestionText: string;
  evidence?: string;
  confidence: Confidence;
  proposedDiff?: string;
}

interface DecisionSummaryEntry {
  kind: string;
  summary: string;
  evidence?: string;
}

interface QualityScore {
  personaId: string;
  score: number;
  trend: 'improving' | 'stable' | 'declining';
  sampleCount: number;
  rationale?: string;
}

interface LearningEntry {
  observation: string;
  rationale: string;
  improvementKind: ImprovementKind;
  targetPath?: string;
  confidence: Confidence;
}

interface DecisionPattern {
  pattern: string;
  occurrences: number;
  confidence: Confidence;
  note?: string;
}

interface RetroOutputBase {
  outcome: Outcome;
  workItemNumber: number;
  summary: Summary;
  improvementCandidates: ImprovementCandidate[];
  decisionSummaries: DecisionSummaryEntry[];
}

interface LightRetroPayload {
  tier: 'light';
  output: RetroOutputBase;
}

interface DeepRetroPayload {
  tier: 'deep';
  output: RetroOutputBase & {
    triggerReasons: string[];
    personaQualityScores: QualityScore[];
    learningEntries: LearningEntry[];
    decisionPatterns: DecisionPattern[];
  };
}

type RetroPayload = LightRetroPayload | DeepRetroPayload;

const CONFIDENCE_COLOR: Record<Confidence, string> = {
  high: 'bg-green-500/15 text-green-400',
  medium: 'bg-yellow-500/15 text-yellow-400',
  low: 'bg-blue-500/15 text-blue-400',
};

function ConfidenceChip({ confidence }: { confidence: Confidence }) {
  return (
    <span
      className={`text-[10px] font-medium uppercase px-1.5 py-0.5 rounded ${CONFIDENCE_COLOR[confidence]}`}
    >
      {confidence}
    </span>
  );
}

function KindChip({ kind }: { kind: string }) {
  return (
    <span className="font-mono text-[10px] tracking-wider px-1.5 py-0.5 rounded bg-bg-elev-2 text-[color:var(--accent)]">
      {kind}
    </span>
  );
}

function TrendIcon({ trend }: { trend: QualityScore['trend'] }) {
  if (trend === 'improving') return <TrendingUp size={13} className="text-green-500" />;
  if (trend === 'declining') return <TrendingDown size={13} className="text-red-400" />;
  return <Minus size={13} className="text-fg-3" />;
}

function scoreGrade(score: number): { label: string; color: string } {
  if (score >= 0.9) return { label: 'Excellent', color: 'var(--success)' };
  if (score >= 0.8) return { label: 'Strong', color: 'var(--success)' };
  if (score >= 0.7) return { label: 'Solid', color: 'var(--accent)' };
  if (score >= 0.6) return { label: 'Mixed', color: 'var(--warning)' };
  return { label: 'Concerning', color: 'var(--danger)' };
}

function outcomeMeta(outcome: Outcome) {
  if (outcome === 'success')
    return { icon: CheckCircle, color: 'var(--success)', label: 'Success' };
  if (outcome === 'failure') return { icon: XCircle, color: 'var(--danger)', label: 'Failure' };
  return { icon: AlertCircle, color: 'var(--warning)', label: 'Partial' };
}

function SectionHeader({ title, count }: { title: string; count?: number }) {
  return (
    <div className="flex items-baseline justify-between mb-2">
      <div className="text-[10.5px] uppercase tracking-wider text-fg-2">{title}</div>
      {count != null && <div className="text-[11px] text-fg-2 mono tnum">{count}</div>}
    </div>
  );
}

function SummarySection({ summary }: { summary: Summary }) {
  return (
    <div data-testid="retro-summary">
      <SectionHeader title="Summary" />
      <div className="rounded-lg border border-line bg-bg-elev overflow-hidden">
        <SummaryRow label="What went well" body={summary.wentWell} tone="success" isFirst />
        <SummaryRow label="What didn't" body={summary.didNotGoWell} tone="warning" />
        <SummaryRow
          label="Architectural takeaway"
          body={summary.architecturalTakeaway}
          tone="info"
        />
      </div>
    </div>
  );
}

function SummaryRow({
  label,
  body,
  tone,
  isFirst = false,
}: {
  label: string;
  body: string;
  tone: 'success' | 'warning' | 'info';
  isFirst?: boolean;
}) {
  const Icon = tone === 'success' ? CheckCircle : tone === 'warning' ? AlertCircle : RefreshCw;
  const color =
    tone === 'success' ? 'var(--success)' : tone === 'warning' ? 'var(--warning)' : 'var(--accent)';
  return (
    <div className={`flex items-start gap-3 px-4 py-3 ${isFirst ? '' : 'border-t border-line'}`}>
      <Icon size={14} className="shrink-0 mt-0.5" style={{ color }} />
      <div className="flex-1 min-w-0">
        <div className="text-[10.5px] uppercase tracking-wider text-fg-2 mb-0.5">{label}</div>
        <div className="text-[13px] text-fg-2 leading-relaxed">{body}</div>
      </div>
    </div>
  );
}

function PersonaScoresSection({ scores }: { scores: QualityScore[] }) {
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

function CandidateList({ candidates }: { candidates: ImprovementCandidate[] }) {
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

function LearningEntriesSection({ entries }: { entries: LearningEntry[] }) {
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

function DecisionPatternsSection({ patterns }: { patterns: DecisionPattern[] }) {
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

function DecisionSummariesSection({ summaries }: { summaries: DecisionSummaryEntry[] }) {
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

  return (
    <div data-testid="retro-section" className="px-8 py-6 flex flex-col gap-5">
      {/* Section header */}
      <div className="flex items-end gap-3 flex-wrap">
        <div className="flex-1 min-w-0">
          <div className="text-[10.5px] uppercase tracking-wider text-fg-2 mb-1">
            08 · Retrospective
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

      {isDeep && personaScores.length > 0 ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <SummarySection summary={out.summary} />
          <PersonaScoresSection scores={personaScores} />
        </div>
      ) : (
        <SummarySection summary={out.summary} />
      )}

      {/* 2x2 grid for cards: candidates, learnings, patterns, summaries */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <CandidateList candidates={out.improvementCandidates} />
        {isDeep && <LearningEntriesSection entries={learningEntries} />}
        {isDeep && <DecisionPatternsSection patterns={decisionPatterns} />}
        <DecisionSummariesSection summaries={out.decisionSummaries} />
      </div>
    </div>
  );
}
