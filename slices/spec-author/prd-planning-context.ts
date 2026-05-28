import {
  DEFAULT_ARTIFACT_THRESHOLD_BYTES,
  deterministicArtifactKey,
  maybeStoreLargePayload,
} from '@goose-hub/core/agent-artifacts/repository.js';
import type { ArtifactRef } from '@goose-hub/core/agent-artifacts/types.js';
import type { LatestPrdResult } from '@goose-hub/core/prd/read-model.js';

export type PrdPlanningContext = {
  source: LatestPrdResult['source'];
  parentWorkItemId: string;
  prdRunId: string | null;
  title: string;
  problem: string;
  proposedSolution: string;
  outOfScope: string[];
  successCriteria: string[];
  acceptanceCriteria: unknown[];
  journeys: unknown[];
  functionalSpec: unknown | null;
  verticalSlices: unknown[];
  implementationDecisions: unknown[];
  testingDecisions: unknown | null;
  moduleRefs: Array<{
    path: string;
    status: 'existing' | 'planned' | 'unknown';
    source: 'implementationDecision' | 'testingDecision';
    confidence?: 'high' | 'medium' | 'low';
    evidence?: string;
  }>;
  artifactRef?: ArtifactRef;
};

export type BuildPrdPlanningContextInput = {
  projectId: string;
  parentWorkItemId: string;
  pipelineRunId: string;
  latestPrd: LatestPrdResult;
  artifactThresholdBytes?: number;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringField(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  return typeof value === 'string' ? value : '';
}

function stringArrayField(record: Record<string, unknown>, key: string): string[] {
  const value = record[key];
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function arrayField(record: Record<string, unknown>, key: string): unknown[] {
  const value = record[key];
  return Array.isArray(value) ? value : [];
}

function normalizeModuleRef(
  value: unknown,
  source: 'implementationDecision' | 'testingDecision',
): PrdPlanningContext['moduleRefs'][number] | null {
  if (typeof value === 'string' && value.trim() !== '') {
    return { path: value.trim(), status: 'unknown', source };
  }
  const record = asRecord(value);
  const path = stringField(record, 'path').trim();
  if (path === '') return null;
  const rawStatus = record.status;
  const status =
    rawStatus === 'existing' || rawStatus === 'planned' ? rawStatus : ('unknown' as const);
  const rawConfidence = record.confidence;
  const confidence =
    rawConfidence === 'high' || rawConfidence === 'medium' || rawConfidence === 'low'
      ? rawConfidence
      : undefined;
  const evidence = stringField(record, 'evidence');
  return {
    path,
    status,
    source,
    ...(confidence != null ? { confidence } : {}),
    ...(evidence !== '' ? { evidence } : {}),
  };
}

function collectModuleRefs(prd: Record<string, unknown>): PrdPlanningContext['moduleRefs'] {
  const refs: PrdPlanningContext['moduleRefs'] = [];
  for (const decision of arrayField(prd, 'implementationDecisions')) {
    const record = asRecord(decision);
    const ref = normalizeModuleRef(record.moduleRef, 'implementationDecision');
    if (ref != null) refs.push(ref);
  }
  const testing = asRecord(prd.testingDecisions);
  const modulesToTest = testing.modulesToTest;
  if (Array.isArray(modulesToTest)) {
    for (const moduleRef of modulesToTest) {
      const ref = normalizeModuleRef(moduleRef, 'testingDecision');
      if (ref != null) refs.push(ref);
    }
  }
  return refs;
}

export function buildPrdPlanningContext(
  input: BuildPrdPlanningContextInput,
): PrdPlanningContext | null {
  if (input.latestPrd.prd == null) return null;

  const prd = asRecord(input.latestPrd.prd);
  const stored = maybeStoreLargePayload({
    projectId: input.projectId,
    workItemId: input.parentWorkItemId,
    runId: input.pipelineRunId,
    kind: 'prd-planning-context.raw-prd',
    payload: input.latestPrd.prd,
    summary: `Full PRD for ${input.parentWorkItemId}`,
    artifactKey: deterministicArtifactKey({
      projectId: input.projectId,
      workItemId: input.parentWorkItemId,
      runId: input.pipelineRunId,
      kind: 'prd-planning-context.raw-prd',
      discriminator: input.latestPrd.runId ?? input.latestPrd.createdAt,
    }),
    thresholdBytes: input.artifactThresholdBytes ?? DEFAULT_ARTIFACT_THRESHOLD_BYTES,
  });

  return {
    source: input.latestPrd.source,
    parentWorkItemId: input.parentWorkItemId,
    prdRunId: input.latestPrd.runId,
    title: stringField(prd, 'title'),
    problem: stringField(prd, 'problem'),
    proposedSolution: stringField(prd, 'proposedSolution'),
    outOfScope: stringArrayField(prd, 'outOfScope'),
    successCriteria: stringArrayField(prd, 'successCriteria'),
    acceptanceCriteria: arrayField(prd, 'acceptanceCriteria'),
    journeys: arrayField(prd, 'journeys'),
    functionalSpec: prd.functionalSpec ?? null,
    verticalSlices: arrayField(prd, 'verticalSlices'),
    implementationDecisions: arrayField(prd, 'implementationDecisions'),
    testingDecisions: prd.testingDecisions ?? null,
    moduleRefs: collectModuleRefs(prd),
    ...(stored.stored ? { artifactRef: stored } : {}),
  };
}
