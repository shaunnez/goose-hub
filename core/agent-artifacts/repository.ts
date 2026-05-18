import { createHash, randomUUID } from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
import { db } from '../db/db.js';
import { agentArtifacts } from '../db/schema.js';
import { redactSecrets } from '../tool-layer/secret-redaction.js';
import type { ArtifactRef, StoredArtifact } from './types.js';

export const DEFAULT_ARTIFACT_THRESHOLD_BYTES = 25 * 1024;

export type StoreArtifactInput = {
  projectId: string;
  workItemId?: string | null;
  runId: string;
  kind: string;
  payload: unknown;
  summary: string;
  artifactKey?: string;
  expiresAt?: string | null;
};

export type MaybeStoreLargePayloadInput<T = unknown> = StoreArtifactInput & {
  payload: T;
  thresholdBytes?: number;
};

export type MaybeStoreLargePayloadResult<T = unknown> = { stored: false; payload: T } | ArtifactRef;

function generatedArtifactKey(kind: string): string {
  return `${kind}:${randomUUID()}`;
}

export function deterministicArtifactKey(parts: {
  projectId: string;
  workItemId?: string | null;
  runId: string;
  kind: string;
  discriminator: string;
}): string {
  const hash = createHash('sha256')
    .update(
      JSON.stringify({
        projectId: parts.projectId,
        workItemId: parts.workItemId ?? null,
        runId: parts.runId,
        kind: parts.kind,
        discriminator: parts.discriminator,
      }),
    )
    .digest('hex')
    .slice(0, 24);
  return `${parts.kind}:${hash}`;
}

function isExpired(expiresAt: string | null): boolean {
  return expiresAt != null && Date.parse(expiresAt) <= Date.now();
}

function serializePayload(payload: unknown): string {
  return JSON.stringify(payload ?? null);
}

function rowToArtifact(row: typeof agentArtifacts.$inferSelect): StoredArtifact | null {
  if (isExpired(row.expiresAt)) return null;
  return {
    id: row.id,
    artifactKey: row.artifactKey,
    projectId: row.projectId,
    workItemId: row.workItemId,
    runId: row.runId,
    kind: row.kind,
    summary: row.summary,
    payload: JSON.parse(row.payloadJson) as unknown,
    bytes: row.bytes,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
  };
}

export function storeArtifact(input: StoreArtifactInput): ArtifactRef {
  const redactedPayload = redactSecrets(input.payload);
  const payloadJson = serializePayload(redactedPayload);
  const bytes = Buffer.byteLength(payloadJson, 'utf8');
  const artifactKey = input.artifactKey ?? generatedArtifactKey(input.kind);

  const row = db
    .insert(agentArtifacts)
    .values({
      artifactKey,
      projectId: input.projectId,
      workItemId: input.workItemId ?? null,
      runId: input.runId,
      kind: input.kind,
      summary: input.summary,
      payloadJson,
      bytes,
      expiresAt: input.expiresAt ?? null,
    })
    .onConflictDoUpdate({
      target: agentArtifacts.artifactKey,
      set: {
        projectId: input.projectId,
        workItemId: input.workItemId ?? null,
        runId: input.runId,
        kind: input.kind,
        summary: input.summary,
        payloadJson,
        bytes,
        expiresAt: input.expiresAt ?? null,
      },
    })
    .returning({
      artifactKey: agentArtifacts.artifactKey,
      kind: agentArtifacts.kind,
      summary: agentArtifacts.summary,
      bytes: agentArtifacts.bytes,
    })
    .get();

  return {
    artifactKey: row.artifactKey,
    kind: row.kind,
    summary: row.summary,
    bytes: row.bytes,
    stored: true,
  };
}

export function getArtifact(artifactKey: string): StoredArtifact | null {
  const row = db
    .select()
    .from(agentArtifacts)
    .where(eq(agentArtifacts.artifactKey, artifactKey))
    .get();
  return row == null ? null : rowToArtifact(row);
}

export function listArtifactsForRun(runId: string): StoredArtifact[] {
  return db
    .select()
    .from(agentArtifacts)
    .where(eq(agentArtifacts.runId, runId))
    .all()
    .flatMap((row) => {
      const artifact = rowToArtifact(row);
      return artifact == null ? [] : [artifact];
    });
}

export function listArtifactsForWorkItem(projectId: string, workItemId: string): StoredArtifact[] {
  return db
    .select()
    .from(agentArtifacts)
    .where(and(eq(agentArtifacts.projectId, projectId), eq(agentArtifacts.workItemId, workItemId)))
    .all()
    .flatMap((row) => {
      const artifact = rowToArtifact(row);
      return artifact == null ? [] : [artifact];
    });
}

export function listProjectLevelArtifacts(projectId: string): StoredArtifact[] {
  return db
    .select()
    .from(agentArtifacts)
    .where(and(eq(agentArtifacts.projectId, projectId), isNull(agentArtifacts.workItemId)))
    .all()
    .flatMap((row) => {
      const artifact = rowToArtifact(row);
      return artifact == null ? [] : [artifact];
    });
}

export function maybeStoreLargePayload<T = unknown>(
  input: MaybeStoreLargePayloadInput<T>,
): MaybeStoreLargePayloadResult<T> {
  const thresholdBytes = input.thresholdBytes ?? DEFAULT_ARTIFACT_THRESHOLD_BYTES;
  const redactedPayload = redactSecrets(input.payload) as T;
  const serialized = serializePayload(redactedPayload);
  const bytes = Buffer.byteLength(serialized, 'utf8');

  if (bytes <= thresholdBytes) {
    return { stored: false, payload: redactedPayload };
  }

  return storeArtifact({
    projectId: input.projectId,
    workItemId: input.workItemId,
    runId: input.runId,
    kind: input.kind,
    payload: redactedPayload,
    summary: input.summary,
    artifactKey: input.artifactKey,
    expiresAt: input.expiresAt,
  });
}
