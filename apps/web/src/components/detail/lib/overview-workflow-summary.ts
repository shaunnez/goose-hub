import type { AgentEventDto, TriageResultDto, WorkItemDto } from '@/lib/types';
import type { IssueCostsBreakdown, StageBreakdown } from './costs';
import {
  READ_TOOLS,
  SEARCH_TOOLS,
  countToolCalls,
  extractInvestigationPayload,
} from './investigation';
import { VERDICT_LABEL } from './review';

export type OverviewWorkflowCardKey =
  | 'triage'
  | 'investigation'
  | 'grill'
  | 'prd'
  | 'review'
  | 'retro';

export type OverviewWorkflowCardTone =
  | 'neutral'
  | 'active'
  | 'success'
  | 'warning'
  | 'danger'
  | 'muted';

export type OverviewWorkflowMetric = {
  label: string;
  value: string;
  tone?: string;
};

export type OverviewWorkflowFooter = {
  tokens: number;
  usd: number;
  label: 'exact' | 'estimated';
};

export type OverviewWorkflowCard = {
  key: OverviewWorkflowCardKey;
  title: string;
  status: string;
  statusTone: OverviewWorkflowCardTone;
  metrics: OverviewWorkflowMetric[];
  footer?: OverviewWorkflowFooter;
  hrefSection?: string;
};

type BuildOverviewWorkflowSummaryArgs = {
  item: WorkItemDto;
  events: AgentEventDto[];
  triage?: TriageResultDto | null;
  costs?: IssueCostsBreakdown | null;
};

type CostsWithSkill = IssueCostsBreakdown & { bySkill?: Map<string, StageBreakdown> };

type UnknownRecord = Record<string, unknown>;

const ORDER: Array<{ key: OverviewWorkflowCardKey; title: string; hrefSection: string }> = [
  { key: 'triage', title: 'Triage', hrefSection: 'triage' },
  { key: 'investigation', title: 'Investigation', hrefSection: 'investigation' },
  { key: 'grill', title: 'Grill', hrefSection: 'grill' },
  { key: 'prd', title: 'PRD', hrefSection: 'prd' },
  { key: 'review', title: 'Review', hrefSection: 'review' },
  { key: 'retro', title: 'Retro', hrefSection: 'retro' },
];

const PRD_ACTIVE_STATES = new Set(['factory:writing-prd', 'factory:prd-review']);
const PRD_SUCCESS_STATES = new Set([
  'factory:prd-approved',
  'factory:decomposing',
  'factory:dev-ready',
]);
const PRD_WARNING_STATES = new Set(['factory:prd-rejected', 'factory:prd-revised']);
const PRD_DANGER_STATES = new Set(['factory:prd-declined']);

export function buildOverviewWorkflowSummary({
  item,
  events,
  triage = null,
  costs = null,
}: BuildOverviewWorkflowSummaryArgs): OverviewWorkflowCard[] {
  const cards = new Map<OverviewWorkflowCardKey, OverviewWorkflowCard>();

  for (const definition of ORDER) {
    cards.set(definition.key, {
      key: definition.key,
      title: definition.title,
      status: 'Not run',
      statusTone: 'neutral',
      metrics: [],
      hrefSection: definition.hrefSection,
    });
  }

  cards.set('triage', buildTriageCard(item, triage, stageFooter(costs, 'triage')));
  cards.set('investigation', buildInvestigationCard(events, stageFooter(costs, 'investigate')));
  cards.set('grill', buildGrillCard(item, events, skillFooter(costs, 'grill-me')));
  cards.set('prd', buildPrdCard(item, events, skillFooter(costs, 'write-prd')));
  cards.set('review', buildReviewCard(events, stageFooter(costs, 'review')));
  cards.set('retro', buildRetroCard(events, stageFooter(costs, 'retrospective')));

  return ORDER.map(({ key }) => cards.get(key) as OverviewWorkflowCard);
}

function buildTriageCard(
  item: WorkItemDto,
  triage: TriageResultDto | null,
  footer?: OverviewWorkflowFooter,
): OverviewWorkflowCard {
  const triageRecord = asRecord(triage);
  const metrics: OverviewWorkflowMetric[] = [
    metric('Priority', titleCase(firstString(triageRecord?.priority, item.priority))),
    metric('Type', titleCase(firstString(triageRecord?.type, item.type))),
  ].filter(isMetric);

  if (triageRecord == null) {
    return card('triage', 'Triage', 'Not run', 'neutral', metrics, footer);
  }

  const repo = firstString(
    triageRecord.repo,
    triageRecord.repoRef,
    triageRecord.selectedRepo,
    triageRecord.pickedRepo,
  );
  const confidence = formatPercent(firstNumber(triageRecord.confidence));
  const candidates = arrayCount(
    triageRecord.candidates,
    triageRecord.candidateRepos,
    triageRecord.repoCandidates,
  );
  const override = firstBoolean(
    triageRecord.override,
    triageRecord.hasOverride,
    triageRecord.repoOverridden,
  );

  if (repo != null) metrics.push(metric('Repo', repo));
  if (confidence != null) metrics.push(metric('Confidence', confidence));
  if (candidates != null) metrics.push(metric('Candidates', String(candidates)));
  if (override != null) metrics.push(metric('Override', override ? 'Yes' : 'No'));

  return card('triage', 'Triage', 'Complete', 'success', dedupeMetrics(metrics), footer);
}

function buildInvestigationCard(
  events: AgentEventDto[],
  footer?: OverviewWorkflowFooter,
): OverviewWorkflowCard {
  const event = latestEvent(events, 'agent.investigation-complete');
  if (event == null) {
    return card('investigation', 'Investigation', 'Not run', 'neutral', [], footer);
  }

  const investigate = extractInvestigationPayload(event)?.investigate as UnknownRecord | undefined;
  const confidence = firstString(investigate?.confidence);
  const keyFiles = toArray(investigate?.keyFiles).length;
  const openQuestions = toArray(investigate?.openQuestions).length;
  const reproStatus = extractReproStatus(investigate);

  const metrics = [
    metric('Confidence', titleCase(confidence)),
    metric('Key files', String(keyFiles)),
    metric('Questions', String(openQuestions)),
    metric('Reads', String(countToolCalls(events, READ_TOOLS))),
    metric('Searches', String(countToolCalls(events, SEARCH_TOOLS))),
    metric('Repro', titleCase(reproStatus)),
  ].filter(isMetric);

  return card(
    'investigation',
    'Investigation',
    investigationStatus(confidence),
    investigationTone(confidence),
    metrics,
    footer,
  );
}

function buildGrillCard(
  item: WorkItemDto,
  events: AgentEventDto[],
  footer?: OverviewWorkflowFooter,
): OverviewWorkflowCard {
  const questionCount = events.filter((event) => event.kind === 'grill.question-posted').length;
  const completionEvent = latestEvent(events, 'grill.completed');
  const completion = asRecord(completionEvent?.payload);
  const discover = hasDiscoverActivity(item, events);

  if (!discover) return card('grill', 'Grill', 'N/A', 'muted', [], footer);
  if (completion != null) {
    const forced = firstBoolean(completion.forced, completion.forcedCompletion);
    const rounds = firstNumber(completion.rounds, completion.roundCount);
    return card(
      'grill',
      'Grill',
      forced ? 'Forced' : 'Completed',
      forced ? 'warning' : 'success',
      [
        metric('Questions', String(questionCount)),
        metric('Rounds', rounds == null ? null : String(rounds)),
        metric('Forced', forced == null ? null : forced ? 'Yes' : 'No'),
      ].filter(isMetric),
      footer,
    );
  }
  if (questionCount > 0) {
    return card(
      'grill',
      'Grill',
      'Active',
      'active',
      [metric('Questions', String(questionCount))].filter(isMetric),
      footer,
    );
  }
  return card('grill', 'Grill', 'Waiting', 'neutral', [], footer);
}

function buildPrdCard(
  item: WorkItemDto,
  events: AgentEventDto[],
  footer?: OverviewWorkflowFooter,
): OverviewWorkflowCard {
  const drafted = latestEvent(events, 'prd.drafted');
  const discover = hasDiscoverActivity(item, events);
  if (!discover) return card('prd', 'PRD', 'N/A', 'muted', [], footer);

  const payload = asRecord(drafted?.payload);
  const prd = asRecord(payload?.prd);
  const metrics = [
    metric('Complexity', firstString(prd?.complexity)),
    metric('ACs', countStructured(prd?.acceptanceCriteria, prd?.acceptance_criteria)),
    metric('Journeys', countStructured(prd?.journeys)),
    metric('Slices', countStructured(prd?.verticalSlices, prd?.slices)),
    metric('Advisor', countStructured(payload?.advisorConcerns, payload?.advisor_concerns)),
  ].filter(isMetric);

  return card(
    'prd',
    'PRD',
    prdStatus(item, drafted != null),
    prdTone(item, drafted != null),
    metrics,
    footer,
  );
}

function buildReviewCard(
  events: AgentEventDto[],
  footer?: OverviewWorkflowFooter,
): OverviewWorkflowCard {
  const event = latestEvent(events, 'review.completed');
  if (event == null) return card('review', 'Review', 'Not run', 'neutral', [], footer);

  const payload = asRecord(event.payload);
  const verdict = firstString(payload?.verdict);
  const confidence = formatPercent(firstNumber(payload?.confidence));
  const criteriaChecks = toArray(payload?.criteriaChecks);
  const criteriaMet = criteriaChecks.filter((entry) => asRecord(entry)?.status === 'met').length;
  const findings = toArray(payload?.findings);
  const severityCounts = countSeverities(findings);
  const prStatus = firstString(asRecord(payload?.pr)?.status, payload?.prStatus);

  const metrics = [
    metric(
      'Verdict',
      verdict == null
        ? null
        : ((VERDICT_LABEL as Record<string, string>)[verdict] ?? titleCase(verdict)),
    ),
    metric('Confidence', confidence),
    metric(
      'Criteria',
      criteriaChecks.length > 0 ? `${criteriaMet}/${criteriaChecks.length}` : null,
    ),
    metric('Blockers', severityCounts.blocker > 0 ? String(severityCounts.blocker) : null),
    metric('Majors', severityCounts.major > 0 ? String(severityCounts.major) : null),
    metric('Minors', severityCounts.minor > 0 ? String(severityCounts.minor) : null),
    metric('PR', titleCase(prStatus)),
  ].filter(isMetric);

  return card(
    'review',
    'Review',
    titleCase(verdict) ?? 'Complete',
    reviewTone(verdict),
    metrics,
    footer,
  );
}

function buildRetroCard(
  events: AgentEventDto[],
  footer?: OverviewWorkflowFooter,
): OverviewWorkflowCard {
  const event = latestEvent(events, 'retrospective.completed');
  if (event == null) return card('retro', 'Retro', 'Not run', 'neutral', [], footer);

  const payload = asRecord(event.payload);
  const tier = firstString(payload?.tier);
  const outcome = firstString(payload?.outcome);
  const candidates = toArray(payload?.improvementCandidates);
  const highConfidence = candidates.filter((candidate) => {
    const record = asRecord(candidate);
    return firstString(record?.confidence) === 'high';
  }).length;

  const metrics = [
    metric('Tier', titleCase(tier)),
    metric('Candidates', String(candidates.length)),
    metric('High conf', String(highConfidence)),
  ];

  if (tier === 'deep') {
    metrics.push(metric('Quality', formatPercent(firstNumber(payload?.quality))));
    metrics.push(metric('Patterns', countStructured(payload?.patterns)));
    metrics.push(metric('Learnings', countStructured(payload?.learnings)));
  }

  return card(
    'retro',
    'Retro',
    titleCase(outcome) ?? 'Complete',
    retroTone(outcome),
    metrics.filter(isMetric),
    footer,
  );
}

function latestEvent(events: AgentEventDto[], kind: string): AgentEventDto | null {
  let latest: AgentEventDto | null = null;
  for (const event of events) {
    if (event.kind !== kind) continue;
    if (latest == null || event.id > latest.id) latest = event;
  }
  return latest;
}

function stageFooter(
  costs: IssueCostsBreakdown | null,
  stage: StageBreakdown['stage'],
): OverviewWorkflowFooter | undefined {
  return toFooter(costs?.byStage.get(stage));
}

function skillFooter(
  costs: IssueCostsBreakdown | null,
  skill: string,
): OverviewWorkflowFooter | undefined {
  return toFooter((costs as CostsWithSkill | null)?.bySkill?.get(skill));
}

function toFooter(breakdown: StageBreakdown | undefined): OverviewWorkflowFooter | undefined {
  if (breakdown == null) return undefined;
  return { tokens: breakdown.tokens, usd: breakdown.usd, label: breakdown.label };
}

function hasDiscoverActivity(item: WorkItemDto, events: AgentEventDto[]): boolean {
  if (events.some((event) => event.kind.startsWith('grill.') || event.kind.startsWith('prd.'))) {
    return true;
  }
  if (
    PRD_ACTIVE_STATES.has(item.state) ||
    PRD_SUCCESS_STATES.has(item.state) ||
    PRD_WARNING_STATES.has(item.state) ||
    PRD_DANGER_STATES.has(item.state)
  ) {
    return true;
  }
  return item.type === 'feature';
}

function prdStatus(item: WorkItemDto, hasDraft: boolean): string {
  if (PRD_ACTIVE_STATES.has(item.state)) return 'Drafting';
  if (item.state === 'factory:prd-approved') return 'Approved';
  if (item.state === 'factory:prd-rejected') return 'Review';
  if (item.state === 'factory:prd-revised') return 'Revised';
  if (item.state === 'factory:prd-declined') return 'Declined';
  if (PRD_SUCCESS_STATES.has(item.state)) return 'Approved';
  if (PRD_WARNING_STATES.has(item.state)) return 'Review';
  if (PRD_DANGER_STATES.has(item.state)) return 'Declined';
  return hasDraft ? 'Drafted' : 'Waiting';
}

function prdTone(item: WorkItemDto, hasDraft: boolean): OverviewWorkflowCardTone {
  if (PRD_ACTIVE_STATES.has(item.state)) return 'active';
  if (item.state === 'factory:prd-approved' || PRD_SUCCESS_STATES.has(item.state)) {
    return 'success';
  }
  if (PRD_WARNING_STATES.has(item.state)) return 'warning';
  if (PRD_DANGER_STATES.has(item.state)) return 'danger';
  return hasDraft ? 'success' : 'neutral';
}

function investigationStatus(confidence?: string | null): string {
  if (confidence === 'high') return 'High confidence';
  if (confidence === 'medium') return 'Medium confidence';
  if (confidence === 'low') return 'Low confidence';
  return 'Complete';
}

function investigationTone(confidence?: string | null): OverviewWorkflowCardTone {
  if (confidence === 'high') return 'success';
  if (confidence === 'medium') return 'warning';
  if (confidence === 'low') return 'danger';
  return 'neutral';
}

function reviewTone(verdict?: string | null): OverviewWorkflowCardTone {
  if (verdict === 'approved') return 'success';
  if (verdict === 'needs-fix') return 'warning';
  if (verdict === 'needs-human') return 'danger';
  return 'neutral';
}

function retroTone(outcome?: string | null): OverviewWorkflowCardTone {
  if (outcome === 'success') return 'success';
  if (outcome === 'partial') return 'warning';
  if (outcome === 'failure') return 'danger';
  return 'neutral';
}

function extractReproStatus(investigate?: UnknownRecord): string | null {
  return firstString(
    asRecord(investigate?.reproduction)?.status,
    asRecord(investigate?.repro)?.status,
    investigate?.reproStatus,
  );
}

function countSeverities(findings: unknown[]): Record<'blocker' | 'major' | 'minor', number> {
  const counts = { blocker: 0, major: 0, minor: 0 };
  for (const finding of findings) {
    const severity = firstString(asRecord(finding)?.severity);
    if (severity === 'blocker' || severity === 'major' || severity === 'minor') counts[severity] += 1;
  }
  return counts;
}

function countStructured(...values: unknown[]): string | null {
  for (const value of values) {
    const list = toArray(value);
    if (list.length > 0) return String(list.length);
    if (Array.isArray(value)) return '0';
  }
  return null;
}

function dedupeMetrics(metrics: OverviewWorkflowMetric[]): OverviewWorkflowMetric[] {
  const seen = new Set<string>();
  return metrics.filter((entry) => {
    const key = `${entry.label}:${entry.value}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function card(
  key: OverviewWorkflowCardKey,
  title: string,
  status: string,
  statusTone: OverviewWorkflowCardTone,
  metrics: OverviewWorkflowMetric[],
  footer?: OverviewWorkflowFooter,
): OverviewWorkflowCard {
  return { key, title, status, statusTone, metrics, footer, hrefSection: key };
}

function metric(label: string, value: string | null | undefined): OverviewWorkflowMetric | null {
  if (value == null || value === '') return null;
  return { label, value };
}

function isMetric(
  metricValue: OverviewWorkflowMetric | null,
): metricValue is OverviewWorkflowMetric {
  return metricValue != null;
}

function asRecord(value: unknown): UnknownRecord | null {
  return value != null && typeof value === 'object' ? (value as UnknownRecord) : null;
}

function toArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === 'string' && value.trim() !== '') return value;
  }
  return null;
}

function firstNumber(...values: unknown[]): number | null {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
  }
  return null;
}

function firstBoolean(...values: unknown[]): boolean | null {
  for (const value of values) {
    if (typeof value === 'boolean') return value;
  }
  return null;
}

function arrayCount(...values: unknown[]): number | null {
  for (const value of values) {
    if (Array.isArray(value)) return value.length;
  }
  return null;
}

function formatPercent(value: number | null): string | null {
  if (value == null) return null;
  return `${Math.round(value * 100)}%`;
}

function titleCase(value: string | null | undefined): string | null {
  if (value == null || value.trim() === '') return null;
  return value
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}
