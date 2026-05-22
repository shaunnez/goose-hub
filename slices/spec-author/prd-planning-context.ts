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
    ...(stored.stored ? { artifactRef: stored } : {}),
  };
}
