import type { AgentEventDto, PrdReadModelDto, TriageResultDto, WorkItemDto } from '@/lib/types';
import { extractInvestigationPayload, latestInvestigationEvent } from './investigation';
import { type RetroPayload, outcomeMeta } from './retrospective';
import { type ReviewPayload, VERDICT_LABEL } from './review';

// 11-section left rail keys for the full-takeover detail page.
// Order and keys come from the Harness 2.1 design; M2 only lights up
// `overview` and `timeline`. Other sections render a DeferredSurface stub.

export interface DetailSection {
  key: string;
  label: string;
  available: boolean;
  milestone?: string;
  description?: string;
}

export type WorkflowSnapshotCardKey =
  | 'triage'
  | 'investigation'
  | 'grill'
  | 'prd'
  | 'review'
  | 'retro';

export type WorkflowSnapshotTone = 'default' | 'muted' | 'success' | 'warning' | 'danger';

export interface WorkflowStageCost {
  usd: number;
  tokens: number;
  runCount: number;
  label: 'estimated' | 'exact';
}

export interface WorkflowSnapshotCard {
  key: WorkflowSnapshotCardKey;
  label: 'Triage' | 'Investigation' | 'Grill' | 'PRD' | 'Review' | 'Retro';
  value: string;
  sub: string;
  tone: WorkflowSnapshotTone;
}

export interface WorkflowSnapshotBuilderInput {
  item?: Partial<WorkItemDto> | null;
  triage?: TriageResultDto | null;
  prd?: PrdReadModelDto | null;
  events?: readonly AgentEventDto[] | null;
  stageCosts?: ReadonlyMap<string, WorkflowStageCost> | null;
}

type LooseRecord = Record<string, unknown>;

interface PrdView {
  acceptanceCriteria?: unknown[];
  journeys?: unknown[];
  verticalSlices?: unknown[];
  estimatedComplexity?: string;
}

const DISCOVER_STATES = new Set([
  'factory:grilling',
  'factory:prd-drafting',
  'factory:prd-review',
  'factory:decomposing',
  'factory:issues-created',
]);

const PRD_APPROVED_STATES = new Set([
  'factory:decomposing',
  'factory:issues-created',
  'factory:spec-ready',
  'factory:dev-ready',
  'factory:in-progress',
  'factory:needs-fix',
  'factory:qa-failed',
  'factory:needs-qa',
  'factory:needs-review',
  'factory:approved',
  'factory:retrospecting',
  'factory:done',
]);

export const SECTIONS: readonly DetailSection[] = [
  { key: 'overview', label: 'Overview', available: true },
  {
    key: 'repo',
    label: 'Triage',
    available: true,
  },
  {
    key: 'investigation',
    label: 'Investigation',
    available: true,
  },
  {
    key: 'grill',
    label: 'Grill',
    available: true,
    description: 'Discover-lane chat between you and the griller agent.',
  },
  {
    key: 'prd',
    label: 'PRD',
    available: true,
    description: 'Grilled scope, acceptance criteria, decomposition into vertical slices.',
  },
  {
    key: 'code',
    label: 'Code',
    available: true,
    description:
      'Playwright captures: screenshots, video, and console errors for bug reproduction.',
  },
  {
    key: 'qa',
    label: 'QA',
    available: true,
    description: 'Holdout QA report — outcome assessed against the original issue.',
  },
  {
    key: 'review',
    label: 'Review',
    available: true,
    description: 'Holdout review verdict, requested changes.',
  },
  {
    key: 'retrospective',
    label: 'Retrospective',
    available: true,
    description: 'Post-merge learning loop — light or deep retrospective output.',
  },
  { key: 'timeline', label: 'Timeline', available: true },
  {
    key: 'costs',
    label: 'Costs',
    available: true,
    description: 'Per-agent token spend, per-run cost, daily budget burn.',
  },
] as const;

export function buildWorkflowSnapshotCards({
  item,
  triage,
  prd,
  events,
  stageCosts,
}: WorkflowSnapshotBuilderInput): WorkflowSnapshotCard[] {
  const safeEvents = events ?? [];
  return [
    buildTriageCard(item, triage, stageCosts),
    buildInvestigationCard(safeEvents, stageCosts),
    buildGrillCard(item, safeEvents, stageCosts),
    buildPrdCard(item, prd, safeEvents, stageCosts),
    buildReviewCard(safeEvents, stageCosts),
    buildRetroCard(safeEvents, stageCosts),
  ];
}

function buildTriageCard(
  item: Partial<WorkItemDto> | null | undefined,
  triage: TriageResultDto | null | undefined,
  stageCosts: ReadonlyMap<string, WorkflowStageCost> | null | undefined,
): WorkflowSnapshotCard {
  const candidates = Array.isArray(triage?.candidates) ? triage.candidates : [];
  const topCandidate = candidates[0];
  const priority = triage?.priority ?? item?.priority ?? null;
  const type = triage?.type ?? item?.type ?? null;
  const selectedRepo = triage?.overrideRepo ?? topCandidate?.repo ?? item?.repoRef ?? null;
  const parts = [
    type != null ? titleCase(type) : null,
    selectedRepo != null ? selectedRepo : null,
    typeof topCandidate?.confidence === 'number'
      ? `${Math.round(topCandidate.confidence * 100)}% confidence`
      : null,
    candidates.length > 0 ? pluralize(candidates.length, 'candidate') : null,
    triage?.overrideRepo ? 'Override' : null,
    formatStageCost(stageCosts, 'triage'),
  ];

  return {
    key: 'triage',
    label: 'Triage',
    value: priority != null ? `${titleCase(priority)} priority` : 'Not run',
    sub: joinParts(parts, priority == null ? 'No triage result yet' : 'Metadata-only summary'),
    tone: priority == null ? 'muted' : 'default',
  };
}

function buildInvestigationCard(
  events: readonly AgentEventDto[],
  stageCosts: ReadonlyMap<string, WorkflowStageCost> | null | undefined,
): WorkflowSnapshotCard {
  const event = latestInvestigationEvent([...events]);
  const payload = event == null ? null : extractInvestigationPayload(event);
  const investigate = payload?.investigate;
  if (investigate == null) {
    return mutedCard(
      'investigation',
      'Investigation',
      'Not run',
      joinParts([formatStageCost(stageCosts, 'investigate')], 'No investigation event yet'),
    );
  }

  return {
    key: 'investigation',
    label: 'Investigation',
    value: `${titleCase(investigate.confidence)} confidence`,
    sub: joinParts(
      [
        pluralize(investigate.keyFiles.length, 'key file'),
        pluralize(investigate.openQuestions.length, 'open question'),
        pluralize(investigate.decisionSummaries.length, 'decision'),
        formatStageCost(stageCosts, 'investigate'),
      ],
      'Completed',
    ),
    tone: investigate.confidence === 'low' ? 'warning' : 'default',
  };
}

function buildGrillCard(
  item: Partial<WorkItemDto> | null | undefined,
  events: readonly AgentEventDto[],
  stageCosts: ReadonlyMap<string, WorkflowStageCost> | null | undefined,
): WorkflowSnapshotCard {
  if (!isDiscoverItem(item)) {
    return mutedCard(
      'grill',
      'Grill',
      'N/A',
      joinParts([formatStageCost(stageCosts, 'discover')], 'Skipped for non-discover work'),
    );
  }

  const grillEvent = latestEvent(events, (event) => event.kind.toLowerCase().includes('grill'));
  if (grillEvent == null) {
    return mutedCard(
      'grill',
      'Grill',
      'Not run',
      joinParts([formatStageCost(stageCosts, 'discover')], 'No grill evidence yet'),
    );
  }

  const payload = unwrapPayload(grillEvent.payload, ['grill']);
  const questionCount = countFromPayload(payload, ['questions', 'questionCount'], ['question']);
  const answerCount = countFromPayload(
    payload,
    ['answers', 'answerCount', 'replyCount'],
    ['answer', 'reply', 'recommendedAnswer'],
  );

  return {
    key: 'grill',
    label: 'Grill',
    value: 'Completed',
    sub: joinParts(
      [
        questionCount > 0 ? pluralize(questionCount, 'question') : null,
        answerCount > 0 ? pluralize(answerCount, 'answer') : null,
        formatStageCost(stageCosts, 'discover'),
      ],
      'Discover evidence captured',
    ),
    tone: 'default',
  };
}

function buildPrdCard(
  item: Partial<WorkItemDto> | null | undefined,
  prdModel: PrdReadModelDto | null | undefined,
  events: readonly AgentEventDto[],
  stageCosts: ReadonlyMap<string, WorkflowStageCost> | null | undefined,
): WorkflowSnapshotCard {
  if (!isDiscoverItem(item)) {
    return mutedCard(
      'prd',
      'PRD',
      'N/A',
      joinParts([formatStageCost(stageCosts, 'discover')], 'Skipped for non-discover work'),
    );
  }

  const prd = toRecord(prdModel?.prd) as PrdView | null;
  const fallbackEvent = latestEvent(events, (event) => event.kind.toLowerCase().includes('prd'));
  const hasEvidence = prd != null || fallbackEvent != null;
  if (!hasEvidence) {
    return mutedCard(
      'prd',
      'PRD',
      'Not run',
      joinParts([formatStageCost(stageCosts, 'discover')], 'No PRD read model yet'),
    );
  }

  const advisorConcernsCount = countAdvisorConcerns(prdModel?.advisorConcerns ?? null);
  const acceptanceCriteriaCount = arrayLength(prd?.acceptanceCriteria);
  const journeyCount = arrayLength(prd?.journeys);
  const sliceCount = arrayLength(prd?.verticalSlices);
  const complexity = typeof prd?.estimatedComplexity === 'string' ? prd.estimatedComplexity : null;
  const status = prdStatus(item?.state, prd != null);

  return {
    key: 'prd',
    label: 'PRD',
    value: status.label,
    sub: joinParts(
      [
        complexity != null ? `${titleCase(complexity)} complexity` : null,
        acceptanceCriteriaCount > 0 ? pluralize(acceptanceCriteriaCount, 'AC') : null,
        journeyCount > 0 ? pluralize(journeyCount, 'journey') : null,
        sliceCount > 0 ? pluralize(sliceCount, 'slice') : null,
        advisorConcernsCount > 0 ? pluralize(advisorConcernsCount, 'concern') : null,
        formatStageCost(stageCosts, 'discover'),
      ],
      'Canonical PRD summary',
    ),
    tone: status.tone,
  };
}

function buildReviewCard(
  events: readonly AgentEventDto[],
  stageCosts: ReadonlyMap<string, WorkflowStageCost> | null | undefined,
): WorkflowSnapshotCard {
  const reviewEvent = latestEvent(events, (event) => {
    const kind = event.kind.toLowerCase();
    return kind.includes('review');
  });
  const review = reviewEvent == null ? null : toReviewPayload(reviewEvent.payload);
  if (review == null) {
    return mutedCard(
      'review',
      'Review',
      'Not run',
      joinParts([formatStageCost(stageCosts, 'review')], 'No review verdict yet'),
    );
  }

  const blockerCount = review.findings.filter((finding) => finding.severity === 'blocker').length;
  const majorCount = review.findings.filter((finding) => finding.severity === 'major').length;
  const minorCount = review.findings.filter((finding) => finding.severity === 'minor').length;

  return {
    key: 'review',
    label: 'Review',
    value: VERDICT_LABEL[review.verdict] ?? titleCase(review.verdict),
    sub: joinParts(
      [
        review.findings.length > 0 ? pluralize(blockerCount, 'blocker') : null,
        review.findings.length > 0 ? pluralize(majorCount, 'major') : null,
        review.findings.length > 0 ? pluralize(minorCount, 'minor') : null,
        formatStageCost(stageCosts, 'review'),
      ],
      review.findings.length === 0 ? 'No findings' : 'Latest review findings',
    ),
    tone:
      review.verdict === 'approved'
        ? 'success'
        : blockerCount > 0 || review.verdict === 'needs-human'
          ? 'danger'
          : 'warning',
  };
}

function buildRetroCard(
  events: readonly AgentEventDto[],
  stageCosts: ReadonlyMap<string, WorkflowStageCost> | null | undefined,
): WorkflowSnapshotCard {
  const retroEvent = latestEvent(events, (event) => {
    const kind = event.kind.toLowerCase();
    return kind.includes('retro') || kind.includes('retrospective');
  });
  const retro = retroEvent == null ? null : toRetroPayload(retroEvent.payload);
  if (retro == null) {
    return mutedCard(
      'retro',
      'Retro',
      'Not run',
      joinParts([formatStageCost(stageCosts, 'retrospective')], 'No retrospective output yet'),
    );
  }

  const outcome = outcomeMeta(retro.output.outcome).label;
  const detailParts =
    retro.tier === 'deep'
      ? [
          outcome,
          pluralize(retro.output.learningEntries.length, 'learning'),
          pluralize(retro.output.decisionPatterns.length, 'pattern'),
          formatStageCost(stageCosts, 'retrospective'),
        ]
      : [
          outcome,
          pluralize(retro.output.improvementCandidates.length, 'improvement'),
          formatStageCost(stageCosts, 'retrospective'),
        ];

  return {
    key: 'retro',
    label: 'Retro',
    value: retro.tier === 'deep' ? 'Deep retro' : 'Light retro',
    sub: joinParts(detailParts, 'Retrospective captured'),
    tone: 'default',
  };
}

function mutedCard(
  key: WorkflowSnapshotCardKey,
  label: WorkflowSnapshotCard['label'],
  value: string,
  sub: string,
): WorkflowSnapshotCard {
  return { key, label, value, sub, tone: 'muted' };
}

function latestEvent(
  events: readonly AgentEventDto[],
  predicate: (event: AgentEventDto) => boolean,
): AgentEventDto | null {
  return events.filter(predicate).reduce<AgentEventDto | null>((latest, event) => {
    if (latest == null) return event;
    if (event.id !== latest.id) return event.id > latest.id ? event : latest;
    return event.createdAt > latest.createdAt ? event : latest;
  }, null);
}

function unwrapPayload(payload: unknown, keys: string[]): LooseRecord | null {
  const record = toRecord(payload);
  if (record == null) return null;
  for (const key of keys) {
    const nested = toRecord(record[key]);
    if (nested != null) return nested;
  }
  return record;
}

function toReviewPayload(payload: unknown): ReviewPayload | null {
  const record = unwrapPayload(payload, ['review']);
  if (record == null) return null;
  if (!Array.isArray(record.findings) || typeof record.verdict !== 'string') return null;
  return record as unknown as ReviewPayload;
}

function toRetroPayload(payload: unknown): RetroPayload | null {
  const record = unwrapPayload(payload, ['retrospective', 'retro']);
  if (record == null) return null;
  if (record.tier !== 'light' && record.tier !== 'deep') return null;
  const output = toRecord(record.output);
  if (output == null || typeof output.outcome !== 'string') return null;
  return record as unknown as RetroPayload;
}

function toRecord(value: unknown): LooseRecord | null {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as LooseRecord;
}

function isDiscoverItem(item: Partial<WorkItemDto> | null | undefined): boolean {
  if (item == null) return false;
  if (item.mode === 'discover' || item.type === 'discover') return true;
  return typeof item.state === 'string' && DISCOVER_STATES.has(item.state);
}

function prdStatus(
  state: string | undefined,
  hasCanonicalPrd: boolean,
): { label: string; tone: WorkflowSnapshotTone } {
  if (state === 'factory:prd-review') return { label: 'In review', tone: 'warning' };
  if (state === 'factory:prd-drafting') return { label: 'Drafting', tone: 'default' };
  if (state === 'factory:grilling') return { label: 'Pending grill', tone: 'muted' };
  if (state != null && PRD_APPROVED_STATES.has(state))
    return { label: 'Approved', tone: 'success' };
  if (hasCanonicalPrd) return { label: 'Drafted', tone: 'default' };
  return { label: 'Not run', tone: 'muted' };
}

function countFromPayload(
  payload: LooseRecord | null,
  arrayKeys: string[],
  singularKeys: string[],
): number {
  if (payload == null) return 0;
  for (const key of arrayKeys) {
    const value = payload[key];
    if (Array.isArray(value)) return value.length;
    if (typeof value === 'number' && Number.isFinite(value)) return value;
  }
  let count = 0;
  for (const key of singularKeys) {
    if (typeof payload[key] === 'string' && payload[key].length > 0) count += 1;
  }
  return count;
}

function countAdvisorConcerns(advisorConcerns: string | null): number {
  if (advisorConcerns == null || advisorConcerns.trim().length === 0) return 0;
  return advisorConcerns
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('- ') || line.startsWith('* ') || line.length > 0).length;
}

function arrayLength(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

function formatStageCost(
  stageCosts: ReadonlyMap<string, WorkflowStageCost> | null | undefined,
  stage: string,
): string | null {
  const cost = stageCosts?.get(stage);
  if (cost == null) return null;
  return `$${cost.usd.toFixed(2)}${cost.label === 'estimated' ? ' est.' : ''}`;
}

function joinParts(parts: Array<string | null | undefined>, fallback: string): string {
  const filtered = parts.filter((part): part is string => part != null && part.length > 0);
  return filtered.length > 0 ? filtered.join(' · ') : fallback;
}

function pluralize(count: number, noun: string): string {
  const suffix = count === 1 ? '' : noun === 'AC' ? '' : 's';
  return `${count} ${noun}${suffix}`;
}

function titleCase(value: string): string {
  return value
    .replace(/[-_]/g, ' ')
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}
