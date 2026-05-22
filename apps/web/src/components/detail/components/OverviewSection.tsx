import { fetchEvents, fetchIssueDiff, fetchTriageResult } from '@/lib/api';
import { laneForState } from '@/lib/lanes.config';
import { renderMarkdownToHtml } from '@/lib/markdown';
import type { AgentEventDto, IssueDiffDto, TriageResultDto, WorkItemDto } from '@/lib/types';
import { getPersonaInitials, getPersonaLabel, usePersonaMap } from '@/lib/usePersonaMap';
import { formatCost, formatTokens } from '@/lib/utils';
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { Link, useParams } from 'react-router-dom';
import { parseDiff } from '../lib/code-diff';
import type { IssueCostsBreakdown, StageBreakdown } from '../lib/costs';
import { useIssueCostsBreakdown } from '../lib/costs';
import {
  READ_TOOLS,
  SEARCH_TOOLS,
  countToolCalls,
  extractInvestigationPayload,
  latestInvestigationEvent,
} from '../lib/investigation';
import type { ParsedPRDView } from '../lib/parse-prd-comment';
import type { DeepRetroPayload, RetroPayload } from '../lib/retrospective';
import type { ReviewFinding, ReviewPayload, ReviewVerdict } from '../lib/review';
import { CommentsSection } from './CommentsSection';
import { DependenciesSection } from './DependenciesSection';
import { StatCard } from './StatCard';

interface OverviewSectionProps {
  item?: WorkItemDto;
  projectSlug?: string;
}

type OverviewWorkflowCardKey = 'triage' | 'investigation' | 'grill' | 'prd' | 'review' | 'retro';

type WorkflowTone = 'neutral' | 'active' | 'success' | 'warning' | 'danger' | 'muted';

export interface OverviewWorkflowCard {
  key: OverviewWorkflowCardKey;
  title: string;
  status: string;
  statusTone: WorkflowTone;
  metrics: Array<{ label: string; value: string; tone?: WorkflowTone }>;
  footer?: { tokens: number; usd: number; label: 'exact' | 'estimated' };
  hrefSection?: string;
}

export interface BuildOverviewWorkflowSummaryInput {
  item?: WorkItemDto;
  events: AgentEventDto[];
  triage?: TriageResultDto | null;
  costs?: Pick<IssueCostsBreakdown, 'byStage'> & {
    bySkill?: Map<string, StageBreakdown>;
  };
}

type EventPayload = Record<string, unknown>;

const WORKFLOW_CARD_ORDER: OverviewWorkflowCardKey[] = [
  'triage',
  'investigation',
  'grill',
  'prd',
  'review',
  'retro',
];

const WORKFLOW_CARD_TITLES: Record<OverviewWorkflowCardKey, string> = {
  triage: 'Triage',
  investigation: 'Investigation',
  grill: 'Grill',
  prd: 'PRD',
  review: 'Review',
  retro: 'Retro',
};

const WORKFLOW_CARD_SECTIONS: Record<OverviewWorkflowCardKey, string> = {
  triage: 'repo',
  investigation: 'investigation',
  grill: 'grill',
  prd: 'prd',
  review: 'review',
  retro: 'retrospective',
};

const TONE_CLASS: Record<WorkflowTone, string> = {
  neutral: 'border-line bg-bg text-fg-2',
  active: 'border-[color:var(--accent)]/30 bg-[color:var(--accent)]/10 text-[color:var(--accent)]',
  success:
    'border-[color:var(--success)]/30 bg-[color:var(--success)]/10 text-[color:var(--success)]',
  warning:
    'border-[color:var(--warning)]/30 bg-[color:var(--warning)]/10 text-[color:var(--warning)]',
  danger: 'border-[color:var(--danger)]/30 bg-[color:var(--danger)]/10 text-[color:var(--danger)]',
  muted: 'border-line bg-bg-elev-2 text-fg-3',
};

function metric(label: string, value: string, tone?: WorkflowTone) {
  return { label, value, ...(tone ? { tone } : {}) };
}

function safeCount(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

function formatPercent(value: unknown): string {
  if (typeof value !== 'number' || Number.isNaN(value)) return '—';
  const pct = value <= 1 ? value * 100 : value;
  return `${Math.round(pct)}%`;
}

function formatConfidenceLabel(value: unknown): string {
  return typeof value === 'string' && value.length > 0 ? value : '—';
}

function formatBoolean(value: unknown, truthy = 'Yes', falsy = 'No'): string {
  return value === true ? truthy : value === false ? falsy : '—';
}

function formatNumber(value: unknown): string {
  return typeof value === 'number' && Number.isFinite(value) ? String(value) : '—';
}

function latestEvent(events: AgentEventDto[], kind: string): AgentEventDto | null {
  return events
    .filter((event) => event.kind === kind)
    .reduce<AgentEventDto | null>((latest, event) => {
      if (latest == null) return event;
      if (event.id !== latest.id) return event.id > latest.id ? event : latest;
      return event.createdAt > latest.createdAt ? event : latest;
    }, null);
}

function payloadOf(event: AgentEventDto | null): EventPayload | null {
  if (event == null || event.payload == null || typeof event.payload !== 'object') return null;
  return event.payload as EventPayload;
}

function firstString(values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === 'string' && value.trim().length > 0) return value;
  }
  return null;
}

function isDiscoverApplicable(item?: WorkItemDto, events: AgentEventDto[] = []): boolean {
  if (item?.type === 'feature') return true;
  if (
    item?.state != null &&
    ['factory:grilling', 'factory:gate-pending', 'factory:prd-drafting', 'factory:prd-review'].some(
      (state) => item.state === state,
    )
  ) {
    return true;
  }
  return events.some((event) =>
    ['grill.question-posted', 'grill.completed', 'prd.drafted'].includes(event.kind),
  );
}

function costForStage(
  costs: BuildOverviewWorkflowSummaryInput['costs'],
  stage: string,
  skill?: string,
): OverviewWorkflowCard['footer'] | undefined {
  const bySkill = costs?.bySkill;
  const breakdown = (skill != null ? bySkill?.get(skill) : undefined) ?? costs?.byStage.get(stage);
  if (breakdown == null) return undefined;
  return { tokens: breakdown.tokens, usd: breakdown.usd, label: breakdown.label };
}

function toneForVerdict(verdict: ReviewVerdict | string | undefined): WorkflowTone {
  if (verdict === 'approved') return 'success';
  if (verdict === 'needs-fix') return 'warning';
  if (verdict === 'needs-human') return 'danger';
  return 'neutral';
}

function prdStatus(
  itemState: string | undefined,
  event: AgentEventDto | null,
): [string, WorkflowTone] {
  if (event != null && itemState !== 'factory:prd-drafting') {
    if (itemState === 'factory:prd-review') return ['In review', 'active'];
    if (itemState === 'factory:decomposing' || itemState === 'factory:issues-created') {
      return ['Approved', 'success'];
    }
    if (itemState === 'factory:done') return ['Done', 'success'];
    return ['Drafted', 'success'];
  }
  if (itemState === 'factory:prd-drafting') return ['Drafting', 'active'];
  return ['Not run', 'neutral'];
}

function buildTriageCard(
  item: WorkItemDto | undefined,
  triage: TriageResultDto | null | undefined,
  events: AgentEventDto[],
  costs: BuildOverviewWorkflowSummaryInput['costs'],
): OverviewWorkflowCard {
  const fallbackPayload = payloadOf(latestEvent(events, 'agent.triage-complete'));
  const fallbackCandidates = Array.isArray(fallbackPayload?.candidates)
    ? (fallbackPayload.candidates as Array<Record<string, unknown>>)
    : [];
  const pickedRepo =
    triage?.overrideRepo ??
    triage?.candidates[0]?.repo ??
    firstString([
      fallbackPayload?.overrideRepo,
      fallbackPayload?.pickedRepo,
      fallbackCandidates[0]?.repo,
      item?.repoRef,
    ]);
  const confidence =
    triage?.candidates[0]?.confidence ??
    (typeof fallbackPayload?.confidence === 'number' ? fallbackPayload.confidence : undefined) ??
    (typeof fallbackCandidates[0]?.confidence === 'number'
      ? (fallbackCandidates[0]?.confidence as number)
      : undefined);
  const candidateCount = triage?.candidates.length ?? fallbackCandidates.length;
  const overrideValue = triage?.overrideRepo ?? fallbackPayload?.overrideRepo;
  const didRun = triage != null || fallbackPayload != null;

  return {
    key: 'triage',
    title: WORKFLOW_CARD_TITLES.triage,
    status: didRun ? 'Complete' : 'Not run',
    statusTone: didRun ? 'success' : 'neutral',
    hrefSection: WORKFLOW_CARD_SECTIONS.triage,
    footer: costForStage(costs, 'triage'),
    metrics: [
      metric(
        'Priority',
        triage?.priority ?? firstString([fallbackPayload?.priority, item?.priority]) ?? '—',
      ),
      metric('Type', triage?.type ?? firstString([fallbackPayload?.type, item?.type]) ?? '—'),
      metric('Repo', pickedRepo ?? '—'),
      metric('Conf', confidence == null ? '—' : formatPercent(confidence)),
      metric('Candidates', candidateCount > 0 ? String(candidateCount) : '—'),
      metric('Override', formatBoolean(overrideValue != null && String(overrideValue).length > 0)),
    ],
  };
}

function buildInvestigationCard(
  events: AgentEventDto[],
  costs: BuildOverviewWorkflowSummaryInput['costs'],
): OverviewWorkflowCard {
  const latest = latestInvestigationEvent(events);
  const payload = latest != null ? extractInvestigationPayload(latest) : null;
  if (payload == null) {
    return {
      key: 'investigation',
      title: WORKFLOW_CARD_TITLES.investigation,
      status: 'Not run',
      statusTone: 'neutral',
      hrefSection: WORKFLOW_CARD_SECTIONS.investigation,
      footer: costForStage(costs, 'investigate'),
      metrics: [
        metric('Conf', '—'),
        metric('Key files', '—'),
        metric('Questions', '—'),
        metric('Reads', '—'),
        metric('Searches', '—'),
        metric('Repro', '—'),
      ],
    };
  }

  const runEvents =
    latest?.runId != null ? events.filter((event) => event.runId === latest.runId) : events;
  const runPayload = payloadOf(latest);
  const playwrightRepro = payloadOf(latest)?.playwrightRepro as Record<string, unknown> | undefined;
  const reproduced = playwrightRepro?.reproduced;

  return {
    key: 'investigation',
    title: WORKFLOW_CARD_TITLES.investigation,
    status: 'Complete',
    statusTone: payload.investigate.confidence === 'high' ? 'success' : 'warning',
    hrefSection: WORKFLOW_CARD_SECTIONS.investigation,
    footer: costForStage(costs, 'investigate'),
    metrics: [
      metric('Conf', formatConfidenceLabel(payload.investigate.confidence)),
      metric('Key files', String(payload.investigate.keyFiles.length)),
      metric('Questions', String(payload.investigate.openQuestions.length)),
      metric('Reads', String(countToolCalls(runEvents, READ_TOOLS))),
      metric('Searches', String(countToolCalls(runEvents, SEARCH_TOOLS))),
      metric(
        'Repro',
        formatBoolean(typeof reproduced === 'boolean' ? reproduced : runPayload?.reproduced),
      ),
    ],
  };
}

function buildGrillCard(
  item: WorkItemDto | undefined,
  events: AgentEventDto[],
  costs: BuildOverviewWorkflowSummaryInput['costs'],
): OverviewWorkflowCard {
  const applicable = isDiscoverApplicable(item, events);
  const questions = events.filter((event) => event.kind === 'grill.question-posted').length;
  const completed = payloadOf(latestEvent(events, 'grill.completed'));
  if (!applicable) {
    return {
      key: 'grill',
      title: WORKFLOW_CARD_TITLES.grill,
      status: 'N/A',
      statusTone: 'muted',
      hrefSection: WORKFLOW_CARD_SECTIONS.grill,
      footer: costForStage(costs, 'discover', 'grill-me'),
      metrics: [
        metric('Questions', '—'),
        metric('Rounds', '—'),
        metric('Forced', '—'),
        metric('State', '—'),
      ],
    };
  }

  const status =
    completed != null
      ? 'Complete'
      : item?.state === 'factory:grilling' || item?.state === 'factory:gate-pending'
        ? 'In progress'
        : questions > 0
          ? 'Started'
          : 'Not run';
  const tone: WorkflowTone =
    completed != null ? 'success' : status === 'In progress' ? 'active' : 'neutral';

  return {
    key: 'grill',
    title: WORKFLOW_CARD_TITLES.grill,
    status,
    statusTone: tone,
    hrefSection: WORKFLOW_CARD_SECTIONS.grill,
    footer: costForStage(costs, 'discover', 'grill-me'),
    metrics: [
      metric('Questions', questions > 0 ? String(questions) : '—'),
      metric('Rounds', formatNumber(completed?.rounds)),
      metric('Forced', formatBoolean(completed?.forcedCompletion)),
      metric('State', item?.state ?? '—'),
    ],
  };
}

function buildPrdCard(
  item: WorkItemDto | undefined,
  events: AgentEventDto[],
  costs: BuildOverviewWorkflowSummaryInput['costs'],
): OverviewWorkflowCard {
  const applicable = isDiscoverApplicable(item, events);
  const draftedEvent = latestEvent(events, 'prd.drafted');
  const drafted = payloadOf(draftedEvent);
  const prd = (drafted?.prd ?? drafted) as ParsedPRDView | null | undefined;
  const advisorConcerns = Array.isArray(drafted?.advisorConcerns)
    ? drafted?.advisorConcerns
    : typeof drafted?.advisorConcerns === 'string' && drafted.advisorConcerns.length > 0
      ? drafted.advisorConcerns.split('\n').filter((line) => line.trim().length > 0)
      : [];

  if (!applicable) {
    return {
      key: 'prd',
      title: WORKFLOW_CARD_TITLES.prd,
      status: 'N/A',
      statusTone: 'muted',
      hrefSection: WORKFLOW_CARD_SECTIONS.prd,
      footer: costForStage(costs, 'discover', 'write-prd'),
      metrics: [
        metric('Complexity', '—'),
        metric('ACs', '—'),
        metric('Journeys', '—'),
        metric('Slices', '—'),
        metric('Concerns', '—'),
      ],
    };
  }

  const [status, statusTone] = prdStatus(item?.state, draftedEvent);

  return {
    key: 'prd',
    title: WORKFLOW_CARD_TITLES.prd,
    status,
    statusTone,
    hrefSection: WORKFLOW_CARD_SECTIONS.prd,
    footer: costForStage(costs, 'discover', 'write-prd'),
    metrics: [
      metric('Complexity', prd?.estimatedComplexity ?? '—'),
      metric('ACs', prd?.acceptanceCriteria != null ? String(prd.acceptanceCriteria.length) : '—'),
      metric('Journeys', prd?.journeys != null ? String(prd.journeys.length) : '—'),
      metric('Slices', prd?.verticalSlices != null ? String(prd.verticalSlices.length) : '—'),
      metric('Concerns', advisorConcerns.length > 0 ? String(advisorConcerns.length) : '—'),
    ],
  };
}

function buildReviewCard(
  events: AgentEventDto[],
  costs: BuildOverviewWorkflowSummaryInput['costs'],
): OverviewWorkflowCard {
  const completed = latestEvent(events, 'review.completed');
  const review = payloadOf(completed) as ReviewPayload | null;
  const prOpened = payloadOf(latestEvent(events, 'pr.opened'));
  if (review == null) {
    return {
      key: 'review',
      title: WORKFLOW_CARD_TITLES.review,
      status: 'Not run',
      statusTone: 'neutral',
      hrefSection: WORKFLOW_CARD_SECTIONS.review,
      footer: costForStage(costs, 'review'),
      metrics: [
        metric('Verdict', '—'),
        metric('Conf', '—'),
        metric('Checks', '—'),
        metric('Blockers', '—'),
        metric('Majors', '—'),
        metric('PR', '—'),
      ],
    };
  }

  const findings = Array.isArray(review.findings) ? (review.findings as ReviewFinding[]) : [];
  const blockers = findings.filter((finding) => finding.severity === 'blocker').length;
  const majors = findings.filter((finding) => finding.severity === 'major').length;
  const metCount = (review.criteriaChecks ?? []).filter((check) => check.status === 'met').length;

  return {
    key: 'review',
    title: WORKFLOW_CARD_TITLES.review,
    status: firstString([review.verdict]) ?? 'Complete',
    statusTone: toneForVerdict(review.verdict),
    hrefSection: WORKFLOW_CARD_SECTIONS.review,
    footer: costForStage(costs, 'review'),
    metrics: [
      metric('Verdict', firstString([review.verdict]) ?? '—'),
      metric('Conf', formatPercent(review.confidence)),
      metric(
        'Checks',
        review.criteriaChecks != null ? `${metCount}/${review.criteriaChecks.length}` : '—',
      ),
      metric('Blockers', blockers > 0 ? String(blockers) : '0'),
      metric('Majors', majors > 0 ? String(majors) : '0'),
      metric('PR', prOpened?.prNumber != null ? `#${String(prOpened.prNumber)}` : '—'),
    ],
  };
}

function buildRetroCard(
  events: AgentEventDto[],
  costs: BuildOverviewWorkflowSummaryInput['costs'],
): OverviewWorkflowCard {
  const completed = latestEvent(events, 'retrospective.completed');
  const retro = payloadOf(completed) as RetroPayload | null;
  if (retro == null) {
    return {
      key: 'retro',
      title: WORKFLOW_CARD_TITLES.retro,
      status: 'Not run',
      statusTone: 'neutral',
      hrefSection: WORKFLOW_CARD_SECTIONS.retro,
      footer: costForStage(costs, 'retrospective'),
      metrics: [
        metric('Tier', '—'),
        metric('Outcome', '—'),
        metric('Candidates', '—'),
        metric('High conf', '—'),
        metric('Patterns', '—'),
        metric('Learnings', '—'),
      ],
    };
  }

  const output = retro.output;
  const highConfidence = output.improvementCandidates.filter(
    (candidate) => candidate.confidence === 'high',
  ).length;
  const isDeep = retro.tier === 'deep';
  const deepRetro = retro as DeepRetroPayload;

  return {
    key: 'retro',
    title: WORKFLOW_CARD_TITLES.retro,
    status: 'Complete',
    statusTone: 'success',
    hrefSection: WORKFLOW_CARD_SECTIONS.retro,
    footer: costForStage(costs, 'retrospective'),
    metrics: [
      metric('Tier', retro.tier),
      metric('Outcome', output.outcome),
      metric('Candidates', String(output.improvementCandidates.length)),
      metric('High conf', String(highConfidence)),
      metric(
        'Patterns',
        isDeep ? String(safeCount(deepRetro.output.decisionPatterns)) : '—',
        isDeep ? undefined : 'muted',
      ),
      metric(
        'Learnings',
        isDeep ? String(safeCount(deepRetro.output.learningEntries)) : '—',
        isDeep ? undefined : 'muted',
      ),
    ],
  };
}

export function buildOverviewWorkflowSummary({
  item,
  events,
  triage,
  costs,
}: BuildOverviewWorkflowSummaryInput): OverviewWorkflowCard[] {
  const cards = [
    buildTriageCard(item, triage, events, costs),
    buildInvestigationCard(events, costs),
    buildGrillCard(item, events, costs),
    buildPrdCard(item, events, costs),
    buildReviewCard(events, costs),
    buildRetroCard(events, costs),
  ];

  return cards.sort(
    (left, right) => WORKFLOW_CARD_ORDER.indexOf(left.key) - WORKFLOW_CARD_ORDER.indexOf(right.key),
  );
}

function WorkflowSummaryCard({
  card,
  slug,
  id,
}: {
  card: OverviewWorkflowCard;
  slug: string;
  id: string;
}) {
  const body = (
    <div className="rounded-lg border border-line bg-bg-elev overflow-hidden h-full">
      <div className="px-4 py-3 border-b border-line bg-bg-elev-2 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[12.5px] font-semibold text-fg truncate">{card.title}</div>
          {card.hrefSection && (
            <div className="text-[10.5px] uppercase tracking-wider text-fg-3">Open section</div>
          )}
        </div>
        <span
          className={`shrink-0 rounded-full border px-2 py-0.5 text-[10.5px] font-medium ${TONE_CLASS[card.statusTone]}`}
        >
          {card.status}
        </span>
      </div>
      <dl className="grid grid-cols-2 gap-x-3 gap-y-2 px-4 py-3">
        {card.metrics.map((entry) => (
          <div key={`${card.key}-${entry.label}`} className="min-w-0">
            <dt className="text-[10.5px] uppercase tracking-wider text-fg-3">{entry.label}</dt>
            <dd
              className={`mt-0.5 text-[12.5px] leading-snug ${
                entry.tone === 'muted' ? 'text-fg-3' : 'text-fg-2'
              }`}
            >
              {entry.value}
            </dd>
          </div>
        ))}
      </dl>
      {card.footer && (
        <div className="px-4 py-2 border-t border-line text-[11px] text-fg-3 flex items-center justify-between gap-2">
          <span>{formatTokens(card.footer.tokens)} tokens</span>
          <span>{formatCost(card.footer.usd, card.footer.label)}</span>
        </div>
      )}
    </div>
  );

  if (card.hrefSection == null) return body;

  return (
    <Link
      to={`/projects/${slug}/items/${id}/${card.hrefSection}`}
      data-testid={`overview-workflow-link-${card.key}`}
      className="block h-full"
    >
      {body}
    </Link>
  );
}

export function OverviewSection({ item, projectSlug }: OverviewSectionProps) {
  const { slug = 'goose-hub-self', id = '' } = useParams<{ slug: string; id: string }>();
  const html = renderMarkdownToHtml(item?.body ?? '');
  const personaMap = usePersonaMap();

  const lane = item?.state ? (laneForState(item.state) ?? item.state.replace('factory:', '')) : '—';
  const depsCount = item?.dependsOn?.length ?? 0;
  const blocksCount = item?.blocks?.length ?? 0;
  const lastAgentLabel = getPersonaLabel(personaMap, item?.lastPersonaId) ?? '—';

  const costs = useIssueCostsBreakdown(slug, id);
  const spentValue = costs.runCount === 0 ? '—' : formatCost(costs.total, costs.totalLabel);
  const spentSub =
    costs.runCount === 0
      ? 'no runs yet'
      : `${formatTokens(costs.totalTokens)} tokens · ${costs.runCount} run${costs.runCount === 1 ? '' : 's'}`;

  const { data: diffData } = useQuery<IssueDiffDto>({
    queryKey: ['issue-diff', slug, id],
    queryFn: () => fetchIssueDiff(slug, id),
    staleTime: 10_000,
    enabled: id !== '',
  });
  const files = useMemo(() => (diffData?.diff ? parseDiff(diffData.diff) : []), [diffData?.diff]);
  const totalAdds = useMemo(() => files.reduce((s, f) => s + f.adds, 0), [files]);
  const totalDels = useMemo(() => files.reduce((s, f) => s + f.dels, 0), [files]);

  const { data: events = [] } = useQuery<AgentEventDto[]>({
    queryKey: ['events', slug, id],
    queryFn: () => fetchEvents(slug, id),
    staleTime: 10_000,
    enabled: id !== '',
  });
  const { data: triage } = useQuery<TriageResultDto | null>({
    queryKey: ['triage', slug, id],
    queryFn: () => fetchTriageResult(slug, id),
    staleTime: 10_000,
    enabled: id !== '',
  });
  const qaPayload = events.find((e) => e.kind === 'qa.completed')?.payload as
    | { testRun?: { passed: number; failed: number; skipped: number } }
    | undefined;
  const testRun = qaPayload?.testRun ?? null;
  const workflowCards = useMemo(
    () =>
      buildOverviewWorkflowSummary({
        item,
        events,
        triage,
        costs:
          'byStage' in costs
            ? {
                byStage: costs.byStage,
                bySkill: (costs as { bySkill?: Map<string, StageBreakdown> }).bySkill,
              }
            : undefined,
      }),
    [costs, events, item, triage],
  );

  return (
    <div data-testid="overview-section" className="px-8 py-6 flex flex-col gap-5">
      {/* Section header */}
      <div>
        <div className="text-[10.5px] uppercase tracking-wider text-fg-2 mb-1">01. Overview</div>
        <h2 className="text-[17px] font-semibold text-fg leading-snug truncate">
          What's happening on this task
        </h2>
        <div className="flex items-center gap-3 mt-1.5 text-[12px] text-fg-3">
          <span className="font-mono">#{item?.externalId}</span>
          <span className="text-fg-5">·</span>
          <span>{item?.state ?? '—'}</span>
        </div>
      </div>

      {/* Stat row */}
      <div className="grid grid-cols-3 lg:grid-cols-7 gap-3">
        <StatCard label="Stage" value={lane} />
        <StatCard
          label="Files"
          value={files.length === 0 ? '—' : String(files.length)}
          sub={files.length > 0 ? `+${totalAdds} / −${totalDels} lines` : undefined}
        />
        <StatCard
          label="Tests"
          value={testRun ? `${testRun.passed} pass` : '—'}
          sub={testRun ? `${testRun.failed} failing · ${testRun.skipped} skipped` : undefined}
          color={testRun && testRun.failed === 0 ? 'var(--success)' : undefined}
        />
        <StatCard
          label="Depends on"
          value={depsCount === 0 ? '—' : String(depsCount)}
          sub={depsCount > 0 ? item?.dependsOn.map((d) => `#${d}`).join(', ') : undefined}
        />
        <StatCard
          label="Blocks"
          value={blocksCount === 0 ? '—' : String(blocksCount)}
          sub={blocksCount > 0 ? item?.blocks.map((d) => `#${d}`).join(', ') : undefined}
        />
        <StatCard label="Last agent" value={lastAgentLabel} />
        <StatCard label="Spent" value={spentValue} sub={spentSub} />
      </div>

      <div
        data-testid="overview-workflow-grid"
        className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3"
      >
        {workflowCards.map((card) => (
          <WorkflowSummaryCard key={card.key} card={card} slug={slug} id={id} />
        ))}
      </div>

      {/* Main content grid */}
      <div className="grid gap-4">
        {/* Brief card */}
        <div className="rounded-lg border border-line bg-bg-elev overflow-hidden">
          <div className="px-4 py-3 border-b border-line bg-bg-elev-2">
            <div className="text-[10.5px] uppercase tracking-wider text-fg-2">Brief</div>
          </div>
          <div className="px-4 py-4">
            <article
              data-testid="overview-body"
              className="prose-fix text-[13.5px]"
              // biome-ignore lint/security/noDangerouslySetInnerHtml: HTML is generated by renderMarkdownToHtml which escapes raw input.
              dangerouslySetInnerHTML={{ __html: html }}
            />
            {item && (
              <div className="border-t border-line mt-4 pt-3 flex items-center gap-2">
                <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-bg-elev-2 border border-line text-[10px] font-semibold text-fg-2 shrink-0">
                  {getPersonaInitials(personaMap, item.lastPersonaId) ?? '?'}
                </span>
                <span className="text-[12px] text-fg-2 truncate">
                  {getPersonaLabel(personaMap, item.lastPersonaId) ?? '—'} · {item.state ?? '—'}
                </span>
              </div>
            )}
          </div>
        </div>
      </div>
      {/* Dependencies */}
      {item != null && projectSlug != null && (
        <DependenciesSection item={item} projectSlug={projectSlug} />
      )}

      {/* Comments card */}
      {item != null && projectSlug != null && (
        <div className="rounded-lg border border-line bg-bg-elev overflow-hidden flex flex-col">
          <div className="px-4 py-3 border-b border-line bg-bg-elev-2 flex items-center justify-between shrink-0">
            <div className="text-[10.5px] uppercase tracking-wider text-fg-2">Comments</div>
          </div>
          <div className="flex-1 overflow-y-auto">
            <CommentsSection
              projectSlug={projectSlug}
              id={item.externalId}
              externalId={item.externalId}
            />
          </div>
        </div>
      )}
    </div>
  );
}
