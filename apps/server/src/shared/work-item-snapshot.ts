import { listArtifactsForWorkItem } from '@goose-hub/core/agent-artifacts/repository.js';
import { listCostsForWorkItem } from '@goose-hub/core/cost/repository.js';
import type { CostLabel, Stage } from '@goose-hub/core/cost/types.js';
import { type AgentEvent, eventStore } from '@goose-hub/core/event-stream/store.js';
import { getIssueWorktreeDiff } from '../domains/issues/diff.js';
import { isValidSlug } from './source.js';
import {
  resolveCanonicalWorkItemForRoute,
  resolveWorkItemForRoute,
} from './work-item-resolution.js';

export const WORK_ITEM_SNAPSHOT_SECTIONS = [
  'issue',
  'triage',
  'investigation',
  'grill',
  'prd',
  'code',
  'qa',
  'review',
  'retrospective',
  'timeline',
  'costs',
  'artifacts',
] as const;

export type WorkItemSnapshotSection = (typeof WORK_ITEM_SNAPSHOT_SECTIONS)[number];
export type WorkItemSnapshotDepth = 'compact' | 'full';

export interface WorkItemSnapshotOptions {
  sections?: WorkItemSnapshotSection[];
  depth?: WorkItemSnapshotDepth;
  timelineLimit?: number;
}

interface WorkItemLike {
  id: string;
  externalId: string;
  repoRef?: string | null;
  title: string;
  body?: string;
  state: string;
  milestoneTitle?: string | null;
  priority?: string | null;
  type?: string | null;
}

interface SourceRef {
  eventId?: number;
  kind?: string;
  runId?: string | null;
  createdAt?: string;
  table?: string;
}

const DEFAULT_SECTIONS: WorkItemSnapshotSection[] = [
  'issue',
  'code',
  'qa',
  'review',
  'costs',
  'timeline',
  'artifacts',
];

const LIFECYCLE_SECTION_KINDS: Partial<Record<WorkItemSnapshotSection, string[]>> = {
  triage: ['agent.triage-complete'],
  investigation: ['agent.investigation-complete', 'spec.completed'],
  grill: ['grill.question-posted', 'grill.decision-crystallized', 'grill.completed'],
  prd: ['prd.drafted', 'prd.approved', 'prd.rejected', 'prd.revised', 'prd.declined'],
  retrospective: ['retrospective.completed', 'audit.completed', 'audit.failed'],
};

export function issueNumberFromWorkItemId(workItemIdOrNumber: string | number): string {
  const raw = String(workItemIdOrNumber);
  const match = raw.match(/#(\d+)$/);
  return match?.[1] ?? raw;
}

export async function canonicalizeWorkItemId(
  projectSlug: string,
  workItemIdOrNumber: string | number,
): Promise<string> {
  if (!isValidSlug(projectSlug)) throw new Error(`invalid project slug '${projectSlug}'`);
  const issueNumber = issueNumberFromWorkItemId(workItemIdOrNumber);
  const resolved = await resolveCanonicalWorkItemForRoute(projectSlug, issueNumber);
  if (!resolved.ok) throw new Error(`project not found: ${projectSlug}`);
  return resolved.data.canonicalWorkItemId;
}

export async function getWorkItemSnapshot(
  projectSlug: string,
  issueNumber: string | number,
  options: WorkItemSnapshotOptions = {},
): Promise<Record<string, unknown>> {
  if (!isValidSlug(projectSlug)) throw new Error(`invalid project slug '${projectSlug}'`);
  const externalId = issueNumberFromWorkItemId(issueNumber);
  const resolved = await resolveWorkItemForRoute(projectSlug, externalId);
  if (!resolved.ok) throw new Error(`project not found: ${projectSlug}`);
  const item = resolved.data.item as WorkItemLike;
  const workItemId = resolved.data.canonicalWorkItemId;
  const projectId = resolved.data.source.projectId;
  const depth = options.depth ?? 'compact';
  const sections = normalizeSections(options.sections);
  const timelineLimit = Math.min(
    Math.max(options.timelineLimit ?? 5, 1),
    depth === 'full' ? 50 : 12,
  );
  const recentEvents = eventStore.replay({
    projectId,
    workItemId,
    order: 'desc',
    limit: Math.max(timelineLimit, 50),
  });

  const snapshot: Record<string, unknown> = {
    projectSlug,
    projectId,
    issueNumber: item.externalId,
    workItemId,
    depth,
    generatedAt: new Date().toISOString(),
    sections: [...sections],
  };

  if (sections.has('issue')) {
    snapshot.issue = buildIssueSection(projectSlug, item, depth);
  }
  if (sections.has('code')) {
    snapshot.code = await buildCodeSection(projectSlug, item.externalId, recentEvents, depth);
  }
  if (sections.has('qa')) {
    snapshot.qa = buildQaSection(latestEvent(projectId, workItemId, 'qa.completed'));
  }
  if (sections.has('review')) {
    snapshot.review = buildReviewSection(latestEvent(projectId, workItemId, 'review.completed'));
  }
  if (sections.has('costs')) {
    snapshot.costs = buildCostsSection(workItemId, depth);
  }
  if (sections.has('timeline')) {
    snapshot.timeline = recentEvents
      .slice(0, timelineLimit)
      .map((event) => compactEvent(event, depth));
  }
  if (sections.has('artifacts')) {
    snapshot.artifacts = buildArtifactsSection(projectId, workItemId, depth);
  }
  for (const section of ['triage', 'investigation', 'grill', 'prd', 'retrospective'] as const) {
    if (sections.has(section)) {
      snapshot[section] = buildLifecycleSection(recentEvents, section, depth);
    }
  }

  return snapshot;
}

function normalizeSections(
  input: WorkItemSnapshotSection[] | undefined,
): Set<WorkItemSnapshotSection> {
  if (input == null || input.length === 0) return new Set(DEFAULT_SECTIONS);
  return new Set(input.filter((section) => WORK_ITEM_SNAPSHOT_SECTIONS.includes(section)));
}

function latestEvent(projectId: string, workItemId: string, kind: string): AgentEvent | null {
  return eventStore.replay({ projectId, workItemId, kind, order: 'desc', limit: 1 })[0] ?? null;
}

function sourceForEvent(event: AgentEvent | null): SourceRef | null {
  if (event == null) return null;
  return {
    eventId: event.id,
    kind: event.kind,
    runId: event.runId ?? null,
    createdAt: event.createdAt,
  };
}

function buildIssueSection(projectSlug: string, item: WorkItemLike, depth: WorkItemSnapshotDepth) {
  return {
    id: item.id,
    number: item.externalId,
    title: item.title,
    state: item.state,
    milestoneTitle: item.milestoneTitle ?? null,
    priority: item.priority ?? null,
    type: item.type ?? null,
    repoRef: item.repoRef ?? null,
    path: `/projects/${projectSlug}/items/${item.externalId}`,
    ...(depth === 'full' ? { body: item.body ?? '' } : {}),
  };
}

async function buildCodeSection(
  projectSlug: string,
  issueNumber: string,
  recentEvents: AgentEvent[],
  depth: WorkItemSnapshotDepth,
) {
  const prEvent =
    recentEvents.find((event) => event.kind === 'pr.opened') ??
    recentEvents.find((event) => event.kind === 'pr.merged');
  const prPayload = payloadRecord(prEvent?.payload);
  const verification = recentEvents.find((event) => event.kind === 'qa.verification-summary-built');
  const verificationPayload = payloadRecord(verification?.payload);
  const code: Record<string, unknown> = {
    prNumber: numberOrNull(prPayload.prNumber),
    prUrl: stringOrNull(prPayload.prUrl),
    branch: stringOrNull(prPayload.branch),
    changedFileCount: numberOrNull(verificationPayload.changedFileCount),
    diffCharCount: numberOrNull(verificationPayload.diffCharCount),
    files: [],
    additions: null,
    deletions: null,
    runId: prEvent?.runId ?? null,
    source: sourceForEvent(prEvent ?? verification ?? null),
  };

  if (depth === 'full') {
    const diffResult = await getIssueWorktreeDiff(projectSlug, issueNumber);
    if (diffResult.ok && diffResult.data.diff != null) {
      const diff = parseUnifiedDiffSummary(diffResult.data.diff);
      code.changedFileCount = diff.files.length;
      code.files = diff.files.map((file) => file.path);
      code.additions = diff.additions;
      code.deletions = diff.deletions;
      code.diffRunId = diffResult.data.runId;
    } else if (diffResult.ok) {
      code.reason = diffResult.data.reason ?? null;
    }
  }

  return code;
}

function buildQaSection(event: AgentEvent | null) {
  if (event == null) return null;
  const payload = payloadRecord(event.payload);
  const testRun = payloadRecord(payload.testRun);
  const findings = Array.isArray(payload.findings)
    ? payload.findings
    : flattenTierFindings(payloadRecord(payload.tierResults));
  return {
    verdict: stringOrNull(payload.verdict),
    score: numberOrNull(payload.overallScore),
    threshold: numberOrNull(payload.threshold),
    testRun:
      payload.testRun != null
        ? {
            total: numberOrNull(testRun.total),
            passed: numberOrNull(testRun.passed),
            failed: numberOrNull(testRun.failed),
            skipped: numberOrNull(testRun.skipped),
            success: typeof testRun.success === 'boolean' ? testRun.success : null,
            wallTimeMs: numberOrNull(testRun.wallTimeMs),
          }
        : null,
    findings: findings.slice(0, 20),
    findingCount: findings.length,
    runId: event.runId ?? null,
    pipelineRunId: stringOrNull(payload.pipelineRunId),
    source: sourceForEvent(event),
  };
}

function buildReviewSection(event: AgentEvent | null) {
  if (event == null) return null;
  const payload = payloadRecord(event.payload);
  const findings = Array.isArray(payload.findings) ? payload.findings : [];
  return {
    verdict: stringOrNull(payload.verdict),
    confidence: numberOrNull(payload.confidence),
    criteriaCheckCount: Array.isArray(payload.criteriaChecks) ? payload.criteriaChecks.length : 0,
    findings: findings.slice(0, 20),
    findingCount: findings.length,
    escalationReason: stringOrNull(payload.escalationReason),
    runId: event.runId ?? null,
    source: sourceForEvent(event),
  };
}

function buildCostsSection(workItemId: string, depth: WorkItemSnapshotDepth) {
  const rows = listCostsForWorkItem(workItemId);
  const byStage = new Map<
    Stage,
    {
      stage: Stage;
      totalUsd: number;
      runCount: number;
      inputTokens: number;
      outputTokens: number;
      costLabel: CostLabel;
    }
  >();
  for (const row of rows) {
    const current = byStage.get(row.stage) ?? {
      stage: row.stage,
      totalUsd: 0,
      runCount: 0,
      inputTokens: 0,
      outputTokens: 0,
      costLabel: 'exact' as CostLabel,
    };
    current.totalUsd += row.costUsd;
    current.runCount += 1;
    current.inputTokens += row.inputTokens;
    current.outputTokens += row.outputTokens;
    if (row.costLabel === 'estimated') current.costLabel = 'estimated';
    byStage.set(row.stage, current);
  }
  const totalUsd = rows.reduce((sum, row) => sum + row.costUsd, 0);
  return {
    totalUsd,
    runCount: rows.length,
    hasEstimated: rows.some((row) => row.costLabel === 'estimated'),
    byStage: [...byStage.values()].sort((a, b) => b.totalUsd - a.totalUsd),
    ...(depth === 'full'
      ? {
          rows: rows.map((row) => ({
            runId: row.runId,
            stage: row.stage,
            skill: row.skill,
            modelId: row.modelId,
            inputTokens: row.inputTokens,
            outputTokens: row.outputTokens,
            costUsd: row.costUsd,
            costLabel: row.costLabel,
            personaId: row.personaId,
            createdAt: row.createdAt,
          })),
        }
      : {}),
    source: { table: 'agent_run_costs' },
  };
}

function buildArtifactsSection(
  projectId: string,
  workItemId: string,
  depth: WorkItemSnapshotDepth,
) {
  const artifacts = listArtifactsForWorkItem(projectId, workItemId)
    .slice()
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  return artifacts.slice(0, depth === 'full' ? 50 : 10).map((artifact) => ({
    artifactKey: artifact.artifactKey,
    kind: artifact.kind,
    summary: artifact.summary,
    runId: artifact.runId,
    bytes: artifact.bytes,
    createdAt: artifact.createdAt,
    expiresAt: artifact.expiresAt,
  }));
}

function buildLifecycleSection(
  recentEvents: AgentEvent[],
  section: WorkItemSnapshotSection,
  depth: WorkItemSnapshotDepth,
) {
  const kinds = LIFECYCLE_SECTION_KINDS[section] ?? [];
  const events = recentEvents.filter((event) => kinds.includes(event.kind));
  const latest = events[0] ?? null;
  return {
    latest: latest == null ? null : compactEvent(latest, depth),
    eventCountInWindow: events.length,
  };
}

function compactEvent(event: AgentEvent, depth: WorkItemSnapshotDepth) {
  const payload = payloadRecord(event.payload);
  return {
    id: event.id,
    kind: event.kind,
    runId: event.runId ?? null,
    personaId: event.personaId ?? null,
    createdAt: event.createdAt,
    summary: extractSummary(event.kind, payload),
    ...(depth === 'full' ? { payload: event.payload } : {}),
  };
}

function extractSummary(kind: string, payload: Record<string, unknown>): string {
  if (typeof payload.summary === 'string') return payload.summary;
  if (typeof payload.message === 'string') return payload.message;
  if (typeof payload.reason === 'string') return payload.reason;
  if (typeof payload.error === 'string') return payload.error;
  if (typeof payload.verdict === 'string') return `${kind}: ${payload.verdict}`;
  if (typeof payload.skill === 'string') return `${kind}: ${payload.skill}`;
  return kind;
}

function flattenTierFindings(tierResults: Record<string, unknown>): unknown[] {
  const findings: unknown[] = [];
  for (const value of Object.values(tierResults)) {
    const tier = payloadRecord(value);
    if (Array.isArray(tier.findings)) findings.push(...tier.findings);
  }
  return findings;
}

function payloadRecord(value: unknown): Record<string, unknown> {
  return value != null && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function parseUnifiedDiffSummary(raw: string): {
  files: Array<{ path: string; additions: number; deletions: number }>;
  additions: number;
  deletions: number;
} {
  const files: Array<{ path: string; additions: number; deletions: number }> = [];
  let current: { path: string; additions: number; deletions: number } | null = null;
  for (const line of raw.split('\n')) {
    if (line.startsWith('diff --git ')) {
      if (current != null) files.push(current);
      const match = line.match(/^diff --git a\/.+ b\/(.+)$/);
      current = { path: match?.[1] ?? line.slice(11), additions: 0, deletions: 0 };
      continue;
    }
    if (current == null) continue;
    if (line.startsWith('+') && !line.startsWith('+++')) current.additions += 1;
    if (line.startsWith('-') && !line.startsWith('---')) current.deletions += 1;
  }
  if (current != null) files.push(current);
  return {
    files,
    additions: files.reduce((sum, file) => sum + file.additions, 0),
    deletions: files.reduce((sum, file) => sum + file.deletions, 0),
  };
}
