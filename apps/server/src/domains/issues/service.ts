import { resolveAcceptanceContract } from '@goose-hub/core/acceptance-contracts/resolver.js';
import { getArtifact, getArtifactSlice } from '@goose-hub/core/agent-artifacts/repository.js';
import { getEngineeringSpec } from '@goose-hub/core/engineering-specs/repository.js';
import { isIssueTimelineEvent } from '@goose-hub/core/event-stream/issue-timeline.js';
import { type AgentEvent, eventStore } from '@goose-hub/core/event-stream/store.js';
import { resolveLatestPrd } from '@goose-hub/core/prd/read-model.js';
import { STATES } from '@goose-hub/core/state-machine/states.js';
import type { StateName } from '@goose-hub/core/state-machine/states.js';
import { legalTargets } from '@goose-hub/core/state-machine/transitions.js';
import {
  SCHEDULE_UI_TO_VALUE,
  type ScheduleUIValue,
} from '@goose-hub/core/state-source/github-labels.js';
import type { Result } from '#shared/middleware.js';
import { getProject } from '#shared/projects.js';
import { resolveActiveMilestone } from '#shared/resolve-milestone.js';
import { getSourceForSlug } from '#shared/source.js';
import {
  resolveCanonicalWorkItemForRoute,
  resolveWorkItemForRoute,
} from '#shared/work-item-resolution.js';
import type { LegalTargetsDto } from '../interventions/dto.js';
import { getLastPersonaIdsByWorkItem } from './internal.js';

type RawObject = Record<string, unknown>;

function isObject(value: unknown): value is RawObject {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function stringValue(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function numberValue(value: unknown, fallback = 0): number {
  return typeof value === 'number' ? value : fallback;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function fileOwnedArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const entry of value) {
    if (typeof entry === 'string') {
      out.push(entry);
    } else if (entry != null && typeof entry === 'object' && 'path' in entry) {
      const path = (entry as { path: unknown }).path;
      if (typeof path === 'string') out.push(path);
    }
  }
  return out;
}

function numberArray(value: unknown): number[] {
  return Array.isArray(value)
    ? value.filter((item): item is number => typeof item === 'number')
    : [];
}

function objectArray(value: unknown): RawObject[] {
  return Array.isArray(value) ? value.filter(isObject) : [];
}

function projectExecutableChecks(value: unknown) {
  return objectArray(value).map((check, index) => ({
    id: stringValue(check.id, `check-${index + 1}`),
    command: stringValue(check.command),
    ...(Array.isArray(check.expectedExitCodes)
      ? { expectedExitCodes: numberArray(check.expectedExitCodes) }
      : {}),
    ...(isObject(check.outputExpectation)
      ? {
          outputExpectation: {
            mode: stringValue(check.outputExpectation.mode) as 'exact' | 'contains' | 'regex',
            value: stringValue(check.outputExpectation.value),
          },
        }
      : {}),
    ...(isObject(check.evidenceExpectation)
      ? {
          evidenceExpectation:
            check.evidenceExpectation.type === 'vitest-json'
              ? {
                  type: 'vitest-json' as const,
                  ...(typeof check.evidenceExpectation.suite === 'string'
                    ? { suite: check.evidenceExpectation.suite }
                    : {}),
                  ...(typeof check.evidenceExpectation.testName === 'string'
                    ? { testName: check.evidenceExpectation.testName }
                    : {}),
                  expectedStatus: 'passed' as const,
                }
              : { type: 'exit-code' as const },
        }
      : {}),
    ...(typeof check.timeoutMs === 'number' ? { timeoutMs: check.timeoutMs } : {}),
    ...(typeof check.kind === 'string'
      ? {
          kind: check.kind as
            | 'unit'
            | 'integration'
            | 'e2e'
            | 'api'
            | 'lint'
            | 'typecheck'
            | 'custom',
        }
      : {}),
  }));
}

function projectEngineeringSpec(record: NonNullable<ReturnType<typeof getEngineeringSpec>>) {
  const s = isObject(record.spec) ? record.spec : {};
  const acceptanceCriteria = objectArray(s.acceptanceCriteria).map((ac, index) => ({
    id: stringValue(ac.id, `AC-${index + 1}`),
    statement: stringValue(ac.statement),
    ...(ac.executableChecks != null
      ? { executableChecks: projectExecutableChecks(ac.executableChecks) }
      : {}),
    ...(ac.journeyRef != null ? { journeyRef: ac.journeyRef as string | null } : {}),
    ...(ac.stepIdx != null ? { stepIdx: ac.stepIdx as number | null } : {}),
    ...(ac.crossCutting != null ? { crossCutting: ac.crossCutting as boolean | null } : {}),
    ...(typeof ac.sourceRef === 'string' ? { sourceRef: ac.sourceRef } : {}),
    ...(typeof ac.source === 'string' ? { source: ac.source } : {}),
  }));

  const architecture = isObject(s.architecture)
    ? {
        current: stringValue(s.architecture.current),
        new: stringValue(s.architecture.new),
        decisionRationale: stringValue(s.architecture.decisionRationale),
      }
    : undefined;

  const schemaChanges = isObject(s.schemaChanges)
    ? {
        ddl: stringArray(s.schemaChanges.ddl),
        migrations: stringArray(s.schemaChanges.migrations),
      }
    : undefined;

  return {
    pipelineRunId: record.pipelineRunId,
    updatedAt: record.updatedAt,
    objective: stringValue(s.objective),
    ...(architecture != null ? { architecture } : {}),
    workPackages: objectArray(s.workPackages).map((wp, index) => ({
      id: stringValue(wp.id, `WP${index + 1}`),
      filesOwned: fileOwnedArray(wp.filesOwned),
      changes: stringValue(wp.changes),
      dependsOn: stringArray(wp.dependsOn),
      builderTier: stringValue(wp.builderTier),
    })),
    executionOrder: objectArray(s.executionOrder).map((batch) => ({
      batch: numberValue(batch.batch),
      wpIds: stringArray(batch.wpIds),
    })),
    verificationTooling: objectArray(s.verificationTooling).map((tool) => ({
      name: stringValue(tool.name),
      command: stringValue(tool.command),
      expectedExitCodes: numberArray(tool.expectedExitCodes),
      ...(tool.inputSpec != null ? { inputSpec: tool.inputSpec as string | null } : {}),
    })),
    acceptanceCriteria,
    acceptanceCriteriaCount: acceptanceCriteria.length,
    interfaceContracts: objectArray(s.interfaceContracts).map((contract) => ({
      name: stringValue(contract.name),
      signature: stringValue(contract.signature),
      file: stringValue(contract.file),
      requiredExports: objectArray(contract.requiredExports).map((requiredExport) => ({
        name: stringValue(requiredExport.name),
        ...(requiredExport.file != null ? { file: stringValue(requiredExport.file) } : {}),
      })),
      ...(contract.lineRange != null ? { lineRange: contract.lineRange as string | null } : {}),
    })),
    ...(schemaChanges != null ? { schemaChanges } : {}),
    constraints: objectArray(s.constraints).map((constraint) => ({
      kind: stringValue(constraint.kind),
      name: stringValue(constraint.name),
      source: stringValue(constraint.source),
    })),
    riskRegister: objectArray(s.riskRegister).map((risk) => ({
      risk: stringValue(risk.risk),
      mitigation: stringValue(risk.mitigation),
      severity: stringValue(risk.severity),
    })),
  };
}

const TYPE_EXCLUDED_LEGAL_TARGETS: Readonly<Record<string, readonly StateName[]>> = {
  bug: ['factory:framing', 'factory:grilling', 'factory:research-pending'],
  feature: ['factory:investigating', 'factory:research-pending'],
};

function buildPrdRelationships(projectId: string): {
  byParent: Map<string, string[]>;
  byChild: Map<string, string>;
} {
  const byParent = new Map<string, string[]>();
  const byChild = new Map<string, string>();
  const decomposeEvents = eventStore.replay({ projectId, kind: 'decompose.completed' });
  for (const ev of decomposeEvents) {
    if (ev.workItemId == null) continue;
    const parentExternalId = ev.workItemId.split('#').pop();
    if (parentExternalId == null) continue;
    const payload = ev.payload as { childIssueNumbers?: number[] };
    const children = (payload.childIssueNumbers ?? []).map(String);
    if (children.length === 0) continue;
    byParent.set(parentExternalId, children);
    for (const c of children) byChild.set(c, parentExternalId);
  }
  return { byParent, byChild };
}

function workItemServerDto(item: { id: string; externalRefs?: unknown }): object {
  return {
    ...(item as object),
    canonicalWorkItemId: item.id,
    externalRefs: Array.isArray(item.externalRefs) ? item.externalRefs : [],
  };
}

export interface CreateIssueRequestDto {
  title?: unknown;
  body?: unknown;
  type?: unknown;
  priority?: unknown;
  milestoneNumber?: unknown;
}

// Public surface for the issues domain. The implementation is split across
// sibling files to keep each concern focused; this barrel re-exports the
// pieces the router and tests depend on.
export { approveIssue, rejectIssue, transitionIssue } from './transitions.js';
export type { TransitionResult } from './transitions.js';
export { getIssueWorktreeDiff } from './diff.js';
export { getIssueTriage, overrideIssueRepo } from './triage.js';
export { approvePRD, declinePRD, proceedToPrd, rejectPRD, revisePRD } from './prd-actions.js';

export async function listIssues(
  slug: string,
  opts?: { all?: boolean },
): Promise<Result<{ items: unknown[] }>> {
  const source = await getSourceForSlug(slug);
  if (source == null) return { ok: false, error: 'project not found', status: 404 };
  const milestoneNumber = opts?.all
    ? undefined
    : ((await resolveActiveMilestone(slug)).milestoneNumber ?? undefined);
  const items = await source.listOpenWork(milestoneNumber);
  const lastPersonaMap = getLastPersonaIdsByWorkItem(slug);
  const titleByExternalId = new Map(items.map((i) => [i.externalId, i.title]));
  const { byParent, byChild } = buildPrdRelationships(slug);
  const enriched = items.map((item) => ({
    ...workItemServerDto(item),
    lastPersonaId: lastPersonaMap.get(item.id) ?? null,
    dependsOnTitles: Object.fromEntries(
      (item.dependsOn ?? [])
        .filter((ref) => titleByExternalId.has(ref))
        .map((ref) => [ref, titleByExternalId.get(ref) ?? '']),
    ),
    prdChildren: byParent.get(item.externalId),
    prdParent: byChild.get(item.externalId),
  }));
  return { ok: true, data: { items: enriched } };
}

export async function createIssue(
  slug: string,
  body: CreateIssueRequestDto,
): Promise<Result<{ item: unknown }>> {
  const title = typeof body.title === 'string' ? body.title.trim() : '';
  if (title.length === 0) return { ok: false, error: 'title is required', status: 400 };

  const project = await getProject(slug);
  if (project == null) return { ok: false, error: 'project not found', status: 404 };
  if (project.source.kind !== 'local-db') {
    return {
      ok: false,
      error: 'local Work Item creation requires a local-db project',
      status: 400,
    };
  }

  const source = await getSourceForSlug(slug);
  if (source == null) return { ok: false, error: 'project not found', status: 404 };

  const type =
    body.type === 'feature' ||
    body.type === 'bug' ||
    body.type === 'chore' ||
    body.type === 'research'
      ? body.type
      : undefined;
  const priority =
    body.priority === 'critical' ||
    body.priority === 'high' ||
    body.priority === 'medium' ||
    body.priority === 'low'
      ? body.priority
      : undefined;
  const milestoneId =
    typeof body.milestoneNumber === 'number' && Number.isInteger(body.milestoneNumber)
      ? String(body.milestoneNumber)
      : undefined;

  const item = await source.createIssue({
    title,
    body: typeof body.body === 'string' ? body.body : '',
    ...(type != null ? { type } : {}),
    ...(priority != null ? { priority } : {}),
    ...(milestoneId != null ? { milestoneId } : {}),
  });

  return { ok: true, data: { item: workItemServerDto(item) } };
}

export async function getIssue(slug: string, id: string): Promise<Result<{ item: unknown }>> {
  const source = await getSourceForSlug(slug);
  if (source == null) return { ok: false, error: 'project not found', status: 404 };
  const item = await source.getItem(id);
  const lastPersonaMap = getLastPersonaIdsByWorkItem(slug);
  const workItemId = (item as { id: string }).id;
  const { byParent, byChild } = buildPrdRelationships(slug);
  const externalId = (item as { externalId: string }).externalId;
  const enriched = {
    ...workItemServerDto(item as { id: string; externalRefs?: unknown }),
    lastPersonaId: lastPersonaMap.get(workItemId) ?? null,
    prdChildren: byParent.get(externalId),
    prdParent: byChild.get(externalId),
  };
  return { ok: true, data: { item: enriched } };
}

export async function getIssueLegalTargets(
  slug: string,
  id: string,
): Promise<Result<LegalTargetsDto>> {
  const source = await getSourceForSlug(slug);
  if (source == null) return { ok: false, error: 'project not found', status: 404 };
  const item = await source.getItem(id);
  const state = item.state;
  if (!(STATES as readonly string[]).includes(state)) {
    return { ok: false, error: `invalid issue state: ${state}`, status: 500 };
  }
  const excluded =
    typeof item.type === 'string' ? (TYPE_EXCLUDED_LEGAL_TARGETS[item.type] ?? []) : [];
  return {
    ok: true,
    data: {
      from: state,
      legalTargets: legalTargets(state).filter((target) => !excluded.includes(target)),
    },
  };
}

export async function getIssueSpec(
  slug: string,
  id: string,
): Promise<
  Result<{
    spec: {
      pipelineRunId: string;
      updatedAt: string;
      objective: string;
      architecture?: { current: string; new: string; decisionRationale: string };
      workPackages: Array<{
        id: string;
        filesOwned: string[];
        changes: string;
        dependsOn: string[];
        builderTier: string;
      }>;
      executionOrder: Array<{ batch: number; wpIds: string[] }>;
      verificationTooling: Array<{
        name: string;
        command: string;
        expectedExitCodes: number[];
        inputSpec?: string | null;
      }>;
      acceptanceCriteria: Array<{
        id: string;
        statement: string;
        executableChecks?: Array<{
          id: string;
          command: string;
          expectedExitCodes?: number[];
          outputExpectation?: {
            mode: 'exact' | 'contains' | 'regex';
            value: string;
          };
          timeoutMs?: number;
          kind?: 'unit' | 'integration' | 'e2e' | 'api' | 'lint' | 'typecheck' | 'custom';
        }>;
        journeyRef?: string | null;
        stepIdx?: number | null;
        crossCutting?: boolean | null;
        sourceRef?: string;
        source?: string;
      }>;
      acceptanceCriteriaCount: number;
      interfaceContracts: Array<{
        name: string;
        signature: string;
        file: string;
        requiredExports: Array<{ name: string; file?: string }>;
        lineRange?: string | null;
      }>;
      schemaChanges?: { ddl: string[]; migrations: string[] };
      constraints: Array<{ kind: string; name: string; source: string }>;
      riskRegister: Array<{ risk: string; mitigation: string; severity: string }>;
    } | null;
  }>
> {
  const resolved = await resolveCanonicalWorkItemForRoute(slug, id);
  if (!resolved.ok) return resolved;
  const workItemId = resolved.data.canonicalWorkItemId;
  const record = getEngineeringSpec(slug, workItemId);
  if (record == null) return { ok: true, data: { spec: null } };
  return {
    ok: true,
    data: {
      spec: projectEngineeringSpec(record),
    },
  };
}

export async function getIssueAcceptanceContract(
  slug: string,
  id: string,
): Promise<
  Result<{
    acceptanceContract: ReturnType<typeof resolveAcceptanceContract>;
  }>
> {
  const source = await getSourceForSlug(slug);
  if (source == null) return { ok: false, error: 'project not found', status: 404 };
  const item = await source.getItem(id);
  const contract = resolveAcceptanceContract({
    projectId: slug,
    workItemId: item.id,
    issueBody: item.body,
  });
  return { ok: true, data: { acceptanceContract: contract } };
}

export async function getIssuePrd(
  slug: string,
  id: string,
): Promise<
  Result<{
    prd: {
      prd: unknown | null;
      advisorConcerns: string | null;
      source: 'event';
      createdAt: string;
      runId: string | null;
    } | null;
  }>
> {
  const resolved = await resolveCanonicalWorkItemForRoute(slug, id);
  if (!resolved.ok) return resolved;
  const workItemId = resolved.data.canonicalWorkItemId;
  const prd = await resolveLatestPrd({
    projectId: slug,
    workItemId,
  });
  return { ok: true, data: { prd } };
}

export async function getIssueArtifact(
  slug: string,
  id: string,
  artifactKey: string,
  slice?: { offset?: number; limit?: number },
): Promise<
  Result<{
    artifact: {
      artifactKey: string;
      projectId: string;
      workItemId: string | null;
      runId: string;
      kind: string;
      summary: string;
      bytes: number;
      createdAt: string;
      expiresAt: string | null;
      payload?: unknown;
      offset?: number;
      limit?: number;
      returnedBytes?: number;
      hasMore?: boolean;
      payloadSlice?: string;
      encoding?: 'json';
    };
  }>
> {
  const resolved = await resolveCanonicalWorkItemForRoute(slug, id);
  if (!resolved.ok) return resolved;
  const expectedWorkItemId = resolved.data.canonicalWorkItemId;

  if (slice?.offset != null || slice?.limit != null) {
    const artifact = getArtifactSlice(artifactKey, slice);
    if (artifact == null) return { ok: false, error: 'artifact not found', status: 404 };
    if (artifact.projectId !== slug) return { ok: false, error: 'artifact not found', status: 404 };
    if (artifact.workItemId !== expectedWorkItemId) {
      return { ok: false, error: 'artifact not found', status: 404 };
    }

    return {
      ok: true,
      data: {
        artifact: {
          artifactKey: artifact.artifactKey,
          projectId: artifact.projectId,
          workItemId: artifact.workItemId,
          runId: artifact.runId,
          kind: artifact.kind,
          summary: artifact.summary,
          bytes: artifact.bytes,
          createdAt: artifact.createdAt,
          expiresAt: artifact.expiresAt,
          offset: artifact.offset,
          limit: artifact.limit,
          returnedBytes: artifact.returnedBytes,
          hasMore: artifact.hasMore,
          payloadSlice: artifact.payloadSlice,
          encoding: artifact.encoding,
        },
      },
    };
  }

  const artifact = getArtifact(artifactKey);
  if (artifact == null) return { ok: false, error: 'artifact not found', status: 404 };
  if (artifact.projectId !== slug) return { ok: false, error: 'artifact not found', status: 404 };
  if (artifact.workItemId !== expectedWorkItemId) {
    return { ok: false, error: 'artifact not found', status: 404 };
  }

  return {
    ok: true,
    data: {
      artifact: {
        artifactKey: artifact.artifactKey,
        projectId: artifact.projectId,
        workItemId: artifact.workItemId,
        runId: artifact.runId,
        kind: artifact.kind,
        summary: artifact.summary,
        bytes: artifact.bytes,
        createdAt: artifact.createdAt,
        expiresAt: artifact.expiresAt,
        payload: artifact.payload,
      },
    },
  };
}

export async function getIssueEvents(
  slug: string,
  id: string,
  opts?: { limit?: number; before?: number; after?: number },
): Promise<Result<{ events: unknown[]; hasMore: boolean }>> {
  const resolved = await resolveCanonicalWorkItemForRoute(slug, id);
  if (!resolved.ok) return resolved;
  const workItemId = resolved.data.canonicalWorkItemId;

  if (opts?.limit != null) {
    const fetched = fetchVisibleIssueTimelineEvents({
      projectId: slug,
      workItemId,
      limit: opts.limit + 1,
      before: opts.before,
      after: opts.after,
    });
    const hasMore = fetched.length > opts.limit;
    return {
      ok: true,
      data: { events: hasMore ? fetched.slice(0, opts.limit) : fetched, hasMore },
    };
  }

  const ascending = eventStore.replay({ projectId: slug, workItemId });
  return {
    ok: true,
    data: { events: [...ascending].filter(isIssueTimelineEvent).reverse(), hasMore: false },
  };
}

function fetchVisibleIssueTimelineEvents(input: {
  projectId: string;
  workItemId: string;
  limit: number;
  before?: number;
  after?: number;
}): AgentEvent[] {
  if (input.after != null) {
    const visible: AgentEvent[] = [];
    let sinceId = input.after;
    const batchSize = Math.max(input.limit, 100);

    while (visible.length < input.limit) {
      const batch = eventStore.replay({
        projectId: input.projectId,
        workItemId: input.workItemId,
        sinceId,
        limit: batchSize,
      });
      if (batch.length === 0) break;
      visible.push(...batch.filter(isIssueTimelineEvent));
      const lastId = batch.at(-1)?.id;
      if (lastId == null || lastId <= sinceId) break;
      sinceId = lastId;
      if (batch.length < batchSize) break;
    }

    return visible;
  }

  const visible: AgentEvent[] = [];
  let before = input.before;
  const batchSize = Math.max(input.limit, 100);

  while (visible.length < input.limit) {
    const batch = eventStore.replay({
      projectId: input.projectId,
      workItemId: input.workItemId,
      limit: batchSize,
      before,
      order: 'desc',
    });
    if (batch.length === 0) break;
    visible.push(...batch.filter(isIssueTimelineEvent));
    before = batch.at(-1)?.id;
    if (before == null) break;
  }

  return visible;
}

export async function getIssueComments(
  slug: string,
  id: string,
): Promise<Result<{ comments: unknown[] }>> {
  const resolved = await resolveWorkItemForRoute(slug, id);
  if (!resolved.ok) return resolved;
  const { source, canonicalWorkItemId: workItemId } = resolved.data;
  const comments = await source.listComments(workItemId);
  return { ok: true, data: { comments } };
}

export async function commentOnIssue(
  slug: string,
  id: string,
  body: string | undefined,
): Promise<Result<{ ok: true }>> {
  if (!body?.trim()) return { ok: false, error: 'body is required', status: 400 };
  const resolved = await resolveWorkItemForRoute(slug, id);
  if (!resolved.ok) return resolved;
  const { source, canonicalWorkItemId: workItemId } = resolved.data;
  await source.comment(workItemId, body.trim());
  eventStore.appendEvent({
    projectId: slug,
    workItemId,
    kind: 'manual.action',
    payload: { action: 'comment', preview: body.trim().slice(0, 80) },
  });
  return { ok: true, data: { ok: true } };
}

export async function setIssueMilestone(
  slug: string,
  id: string,
  milestoneNumber: number | null,
): Promise<Result<{ ok: true }>> {
  const resolved = await resolveWorkItemForRoute(slug, id);
  if (!resolved.ok) return resolved;
  const { source, canonicalWorkItemId: workItemId } = resolved.data;
  await source.setMilestone(workItemId, milestoneNumber);
  eventStore.appendEvent({
    projectId: slug,
    workItemId,
    kind: 'manual.action',
    payload: { action: 'set-milestone', milestoneNumber },
  });
  return { ok: true, data: { ok: true } };
}

const VALID_PRIORITY = ['low', 'medium', 'high', 'critical'] as const;
/**
 * UI-facing schedule values. The labels written to GitHub use `next`/`later`
 * (canonical Schedule), but the UI exposes `backlog`/`icebox` as friendlier
 * synonyms — `SCHEDULE_UI_TO_VALUE` translates before calling the data layer.
 */
const VALID_SCHEDULE = ['current', 'backlog', 'icebox', 'blocked-by'] as const;
const VALID_TYPE = ['feature', 'bug', 'chore', 'research'] as const;

export async function setIssueLabel(
  slug: string,
  id: string,
  group: unknown,
  value: unknown,
): Promise<Result<{ ok: true }>> {
  if (group !== 'priority' && group !== 'schedule' && group !== 'type') {
    return { ok: false, error: 'group must be priority, schedule, or type', status: 400 };
  }
  if (group === 'priority' && !VALID_PRIORITY.includes(value as never)) {
    return { ok: false, error: 'invalid priority', status: 400 };
  }
  if (group === 'schedule' && !VALID_SCHEDULE.includes(value as never)) {
    return { ok: false, error: 'invalid schedule', status: 400 };
  }
  if (group === 'type' && !VALID_TYPE.includes(value as never)) {
    return { ok: false, error: 'invalid type', status: 400 };
  }
  const resolved = await resolveWorkItemForRoute(slug, id);
  if (!resolved.ok) return resolved;
  const { source, canonicalWorkItemId: workItemId } = resolved.data;
  // Translate UI-facing schedule synonyms (`backlog`/`icebox`) to the canonical
  // label values (`next`/`later`) before the data layer sees them. Without
  // this, the in-memory source silently no-ops and GitHub gets an invalid
  // `schedule:backlog` label name.
  const persistedValue =
    group === 'schedule' ? SCHEDULE_UI_TO_VALUE[value as ScheduleUIValue] : (value as string);
  await source.setLabelInGroup(workItemId, group, persistedValue);
  eventStore.appendEvent({
    projectId: slug,
    workItemId,
    kind: 'manual.action',
    payload: { action: `set-${group}`, value: persistedValue },
  });
  return { ok: true, data: { ok: true } };
}
