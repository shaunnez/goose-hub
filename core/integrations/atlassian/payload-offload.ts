import {
  deterministicArtifactKey,
  maybeStoreLargePayload,
} from '../../agent-artifacts/repository.js';
import type { ArtifactRef } from '../../agent-artifacts/types.js';
import type { AtlassianProvider, AtlassianTier } from './dtos.js';

export interface AtlassianPayloadOffloadInput {
  projectId: string;
  workItemId?: string | null;
  runId: string;
  provider: AtlassianProvider;
  tier: AtlassianTier;
  resourceId?: string;
  queryId?: string;
  userFacingArgs: Record<string, unknown>;
  payload: unknown;
  summary: string;
  thresholdBytes?: number;
  expiresAt?: string | null;
}

export type AtlassianPayloadOffloadResult =
  | {
      stored: true;
      summary: string;
      artifactRef: ArtifactRef;
    }
  | {
      stored: false;
      summary: string;
      artifactRef: null;
    };

export function offloadAtlassianPayload(
  input: AtlassianPayloadOffloadInput,
): AtlassianPayloadOffloadResult {
  const id = input.resourceId ?? input.queryId ?? 'query';
  const kind = `atlassian:${input.provider}:${input.tier}:${safeArtifactSegment(id)}`;
  const artifactKey = deterministicArtifactKey({
    projectId: input.projectId,
    workItemId: input.workItemId,
    runId: input.runId,
    kind,
    discriminator: stableStringify({
      provider: input.provider,
      tier: input.tier,
      resourceId: input.resourceId ?? null,
      queryId: input.queryId ?? null,
      userFacingArgs: input.userFacingArgs,
    }),
  });

  const result = maybeStoreLargePayload({
    projectId: input.projectId,
    workItemId: input.workItemId,
    runId: input.runId,
    kind,
    payload: input.payload,
    summary: input.summary,
    artifactKey,
    thresholdBytes: input.thresholdBytes,
    expiresAt: input.expiresAt,
  });

  if (result.stored) {
    return {
      stored: true,
      summary: input.summary,
      artifactRef: result,
    };
  }

  return {
    stored: false,
    summary: input.summary,
    artifactRef: null,
  };
}

function safeArtifactSegment(value: string): string {
  return value
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortForStableStringify(value));
}

function sortForStableStringify(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortForStableStringify);
  if (value == null || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, child]) => [key, sortForStableStringify(child)]),
  );
}
