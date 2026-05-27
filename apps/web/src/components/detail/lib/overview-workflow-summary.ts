import type { AgentEventDto, IssueDiffDto, TriageResultDto, WorkItemDto } from '@/lib/types';
import type { IssueCostsBreakdown, StageBreakdown } from './costs';
import {
  READ_TOOLS,
  SEARCH_TOOLS,
  countToolCalls,
  extractInvestigationPayload,
} from './investigation';
import type { RetroPayload } from './retrospective';
import type { ReviewPayload, ReviewVerdict } from './review';

export type OverviewWorkflowStageKey =
  | 'triage'
  | 'investigation'
  | 'grill'
  | 'prd'
  | 'review'
  | 'retro';

export type OverviewWorkflowStatusTone =
  | 'neutral'
  | 'active'
  | 'success'
  | 'warning'
  | 'danger'
  | 'muted';

export interface OverviewWorkflowCard {
  key: OverviewWorkflowStageKey;
  title: string;
  status: string;
  statusTone: OverviewWorkflowStatusTone;
  metrics: Array<{ label: string; value: string; tone?: OverviewWorkflowStatusTone }>;
  footer?: { tokens: number; usd: number; label: 'exact' | 'estimated' };
  hrefSection?: string;
}

export interface BuildOverviewWorkflowCardsInput {
  item?: WorkItemDto;
  events: AgentEventDto[];
  costs: Pick<IssueCostsBreakdown, 'byStage' | 'bySkill'>;
  diff?: IssueDiffDto | null;
  triage?: TriageResultDto | null;
}

type PrdDraftedPayload = {
  prd?: {
    estimatedComplexity?: string;
    acceptanceCriteria?: unknown[];
    journeys?: unknown[];
    verticalSlices?: unknown[];
  };
  advisorConcerns?: string | null;
} | null;

type GrillCompletedPayload = { rounds?: number; forced?: boolean } | null;
type GrillQuestionPayload = { roundNumber?: number } | null;
type PrOpenedPayload = { prNumber?: number; prUrl?: string } | null;

const STAGE_ORDER: Array<{ key: OverviewWorkflowStageKey; title: string }> = [
  { key: 'triage', title: 'Triage' },
  { key: 'investigation', title: 'Investigation' },
  { key: 'grill', title: 'Grill' },
  { key: 'prd', title: 'PRD' },
  { key: 'review', title: 'Review' },
  { key: 'retro', title: 'Retro' },
];

export function buildOverviewWorkflowCards(
  input: BuildOverviewWorkflowCardsInput,
): OverviewWorkflowCard[] {
  void input.diff;

  return [
    buildTriageCard(input),
    buildInvestigationCard(input),
    buildGrillCard(input),
    buildPrdCard(input),
    buildReviewCard(input),
    buildRetroCard(input),
  ];
}

function buildTriageCard({ triage, costs }: BuildOverviewWorkflowCardsInput): OverviewWorkflowCard {
  const pickedCandidate = triage?.candidates[0];
  return {
    key: 'triage',
    title: titleFor('triage'),
    status: triage ? 'Complete' : 'Not run',
    statusTone: triage ? 'success' : 'muted',
    metrics: [
      metric('Priority', triage?.priority ?? 'N/A'),
      metric('Type', triage?.type ?? 'N/A'),
      metric('Repo', triage?.overrideRepo ?? pickedCandidate?.repo ?? 'N/A'),
      metric('Confidence', formatPercent(pickedCandidate?.confidence)),
      metric('Candidates', triage != null ? String(triage.candidates.length) : 'N/A'),
      metric('Override', triage == null ? 'N/A' : triage.overrideRepo ? 'Yes' : 'No'),
    ],
    footer: footerFor(costs.byStage.get('triage')),
    hrefSection: 'triage',
  };
}

function buildInvestigationCard({
  events,
  costs,
}: BuildOverviewWorkflowCardsInput): OverviewWorkflowCard {
  const event = latestEvent(events, ['agent.investigation-complete']);
  const payload = event ? extractInvestigationPayload(event) : null;
  const repro = extractReproStatus(event);
  const runScopedEvents =
    event?.runId != null ? events.filter((entry) => entry.runId === event.runId) : [];

  return {
    key: 'investigation',
    title: titleFor('investigation'),
    status: event ? 'Complete' : 'Not run',
    statusTone: event ? 'success' : 'muted',
    metrics: [
      metric('Confidence', payload?.investigate.confidence ?? 'N/A'),
      metric('Key files', payload ? String(payload.investigate.keyFiles.length) : 'N/A'),
      metric('Questions', payload ? String(payload.investigate.openQuestions.length) : 'N/A'),
      metric('Reads', event ? String(countToolCalls(runScopedEvents, READ_TOOLS)) : 'N/A'),
      metric('Searches', event ? String(countToolCalls(runScopedEvents, SEARCH_TOOLS)) : 'N/A'),
      metric('Repro', repro),
    ],
    footer: footerFor(costs.byStage.get('investigate')),
    hrefSection: 'investigation',
  };
}

function buildGrillCard({
  item,
  events,
  costs,
}: BuildOverviewWorkflowCardsInput): OverviewWorkflowCard {
  const isDiscoverNarrowedOut = item?.type === 'bug';
  const completed = latestEvent(events, ['grill.completed']);
  const questionEvents = events.filter((event) => event.kind === 'grill.question-posted');
  const latestQuestion = latestEvent(events, ['grill.question-posted']);
  const completedPayload = (completed?.payload as GrillCompletedPayload) ?? null;
  const latestQuestionPayload = (latestQuestion?.payload as GrillQuestionPayload) ?? null;
  const rounds =
    completedPayload?.rounds ??
    latestQuestionPayload?.roundNumber ??
    (questionEvents.length > 0 ? questionEvents.length : null);

  let status = 'Not run';
  let statusTone: OverviewWorkflowStatusTone = 'muted';
  if (isDiscoverNarrowedOut) {
    status = 'N/A';
  } else if (completedPayload?.forced) {
    status = 'Force completed';
    statusTone = 'warning';
  } else if (completed != null) {
    status = 'Complete';
    statusTone = 'success';
  } else if (questionEvents.length > 0 || item?.state === 'factory:grilling') {
    status = item?.state === 'factory:gate-pending' ? 'Awaiting reply' : 'In progress';
    statusTone = 'active';
  }

  return {
    key: 'grill',
    title: titleFor('grill'),
    status,
    statusTone,
    metrics: [
      metric('Questions', isDiscoverNarrowedOut ? 'N/A' : String(questionEvents.length)),
      metric('Rounds', isDiscoverNarrowedOut ? 'N/A' : rounds == null ? 'N/A' : String(rounds)),
      metric(
        'Forced',
        isDiscoverNarrowedOut
          ? 'N/A'
          : completedPayload == null
            ? 'N/A'
            : completedPayload.forced
              ? 'Yes'
              : 'No',
      ),
    ],
    footer: footerFor(costs.bySkill.get('grill-me')),
    hrefSection: 'grill',
  };
}

function buildPrdCard({
  item,
  events,
  costs,
}: BuildOverviewWorkflowCardsInput): OverviewWorkflowCard {
  const isDiscoverNarrowedOut = item?.type === 'bug';
  const drafted = latestEvent(events, ['prd.drafted']);
  const draftedPayload = (drafted?.payload as PrdDraftedPayload) ?? null;
  const prd = draftedPayload?.prd;
  const lifecycleEvent = latestEvent(events, [
    'prd.approved',
    'prd.rejected',
    'prd.revised',
    'prd.declined',
  ]);

  const { status, tone } = prdStatus(
    item?.state,
    lifecycleEvent?.kind,
    drafted != null,
    isDiscoverNarrowedOut,
  );

  return {
    key: 'prd',
    title: titleFor('prd'),
    status,
    statusTone: tone,
    metrics: [
      metric('Complexity', prd?.estimatedComplexity ?? 'N/A'),
      metric('ACs', countMetric(prd?.acceptanceCriteria)),
      metric('Journeys', countMetric(prd?.journeys)),
      metric('Slices', countMetric(prd?.verticalSlices)),
      metric(
        'Advisor',
        draftedPayload != null
          ? String(countAdvisorConcerns(draftedPayload.advisorConcerns))
          : 'N/A',
      ),
    ],
    footer: footerFor(costs.bySkill.get('write-prd')),
    hrefSection: 'prd',
  };
}

function buildReviewCard({ events, costs }: BuildOverviewWorkflowCardsInput): OverviewWorkflowCard {
  const event = latestEvent(events, ['review.completed']);
  const payload = (event?.payload as ReviewPayload | undefined) ?? undefined;
  const severity = { blocker: 0, major: 0, minor: 0 };
  for (const finding of payload?.findings ?? []) {
    if (finding.severity in severity) {
      severity[finding.severity] += 1;
    }
  }
  const met = payload?.criteriaChecks.filter((check) => check.status === 'met').length ?? 0;
  const total = payload?.criteriaChecks.length ?? 0;
  const prOpened = latestEvent(events, ['pr.opened']);
  const prPayload = (prOpened?.payload as PrOpenedPayload) ?? null;
  const { label, tone } = reviewMeta(payload?.verdict);

  return {
    key: 'review',
    title: titleFor('review'),
    status: payload ? label : 'Not run',
    statusTone: payload ? tone : 'muted',
    metrics: [
      metric('Confidence', payload ? formatPercent(payload.confidence) : 'N/A'),
      metric('Criteria', payload ? `${met}/${total} met` : 'N/A'),
      metric('Blockers', payload ? String(severity.blocker) : 'N/A'),
      metric('Major', payload ? String(severity.major) : 'N/A'),
      metric('Minor', payload ? String(severity.minor) : 'N/A'),
      metric('PR', prPayload?.prNumber != null ? `#${prPayload.prNumber} open` : 'N/A'),
    ],
    footer: footerFor(costs.byStage.get('review')),
    hrefSection: 'review',
  };
}

function buildRetroCard({ events, costs }: BuildOverviewWorkflowCardsInput): OverviewWorkflowCard {
  const event = latestEvent(events, ['retrospective.completed']);
  const payload = (event?.payload as RetroPayload | undefined) ?? undefined;
  const output = payload?.output;
  const candidates = output?.improvementCandidates ?? [];
  const highConfidence = candidates.filter((candidate) => candidate.confidence === 'high').length;
  const deepMetrics =
    payload?.tier === 'deep'
      ? [
          metric('Quality', String(payload.output.personaQualityScores.length)),
          metric('Patterns', String(payload.output.decisionPatterns.length)),
          metric('Learnings', String(payload.output.learningEntries.length)),
        ]
      : [];

  return {
    key: 'retro',
    title: titleFor('retro'),
    status: output ? capitalize(output.outcome) : 'Not run',
    statusTone: output ? retroTone(output.outcome) : 'muted',
    metrics: [
      metric('Tier', payload?.tier ?? 'N/A'),
      metric('Candidates', output ? String(candidates.length) : 'N/A'),
      metric('High conf', output ? String(highConfidence) : 'N/A'),
      ...deepMetrics,
    ],
    footer: footerFor(costs.byStage.get('retrospective')),
    hrefSection: 'retro',
  };
}

function latestEvent(events: AgentEventDto[], kinds: string[]): AgentEventDto | null {
  return events
    .filter((event) => kinds.includes(event.kind))
    .reduce<AgentEventDto | null>((latest, event) => {
      if (latest == null) return event;
      if (event.createdAt !== latest.createdAt) {
        return event.createdAt > latest.createdAt ? event : latest;
      }
      return event.id > latest.id ? event : latest;
    }, null);
}

function footerFor(breakdown: StageBreakdown | undefined): OverviewWorkflowCard['footer'] {
  if (breakdown == null) return undefined;
  return { tokens: breakdown.tokens, usd: breakdown.usd, label: breakdown.label };
}

function metric(
  label: string,
  value: string,
  tone?: OverviewWorkflowStatusTone,
): OverviewWorkflowCard['metrics'][number] {
  return tone == null ? { label, value } : { label, value, tone };
}

function titleFor(key: OverviewWorkflowStageKey): string {
  return STAGE_ORDER.find((stage) => stage.key === key)?.title ?? key;
}

function formatPercent(value: number | undefined): string {
  if (value == null || Number.isNaN(value)) return 'N/A';
  return `${Math.round(value <= 1 ? value * 100 : value)}%`;
}

function countMetric(value: unknown[] | undefined): string {
  return value == null ? 'N/A' : String(value.length);
}

function countAdvisorConcerns(value: string | null | undefined): number {
  if (value == null || value.trim().length === 0) return 0;
  const lines = value
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const listItems = lines.filter((line) => /^([-*]|\d+\.)\s+/.test(line));
  return (listItems.length > 0 ? listItems : lines).length;
}

function extractReproStatus(event: AgentEventDto | null): string {
  const payload = event?.payload as
    | { playwrightRepro?: { reproduced?: boolean } }
    | null
    | undefined;
  if (payload?.playwrightRepro?.reproduced === true) return 'Reproduced';
  if (payload?.playwrightRepro?.reproduced === false) return 'Not reproduced';
  return 'N/A';
}

function prdStatus(
  state: string | undefined,
  latestKind: string | undefined,
  hasDraft: boolean,
  isNotApplicable: boolean,
): { status: string; tone: OverviewWorkflowStatusTone } {
  if (isNotApplicable) return { status: 'N/A', tone: 'muted' };
  if (latestKind === 'prd.declined') return { status: 'Declined', tone: 'danger' };
  if (latestKind === 'prd.revised' || latestKind === 'prd.rejected')
    return { status: 'Revised', tone: 'warning' };
  if (latestKind === 'prd.approved') return { status: 'Approved', tone: 'success' };
  if (state === 'factory:prd-drafting') return { status: 'Drafting', tone: 'active' };
  if (state === 'factory:prd-review') return { status: 'In review', tone: 'active' };
  if (hasDraft) return { status: 'Drafted', tone: 'success' };
  return { status: 'Not run', tone: 'muted' };
}

function reviewMeta(verdict: ReviewVerdict | undefined): {
  label: string;
  tone: OverviewWorkflowStatusTone;
} {
  if (verdict === 'approved') return { label: 'Approved', tone: 'success' };
  if (verdict === 'needs-fix') return { label: 'Needs fix', tone: 'warning' };
  if (verdict === 'needs-human') return { label: 'Needs human', tone: 'danger' };
  return { label: 'Not run', tone: 'muted' };
}

function retroTone(outcome: 'success' | 'failure' | 'partial'): OverviewWorkflowStatusTone {
  if (outcome === 'success') return 'success';
  if (outcome === 'failure') return 'danger';
  return 'warning';
}

function capitalize(value: string): string {
  return value.length === 0 ? value : `${value[0].toUpperCase()}${value.slice(1)}`;
}
