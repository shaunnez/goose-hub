import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { db } from '../db/db.js';
import { agentArtifacts } from '../db/schema.js';
import {
  deterministicArtifactKey,
  getArtifact,
  getArtifactSlice,
  listArtifactsForRun,
  listArtifactsForWorkItem,
  maybeStoreLargePayload,
  storeArtifact,
} from './repository.js';

const PROJECT = 'test-agent-artifacts';
const OTHER_PROJECT = 'other-agent-artifacts';
const WORK_ITEM = 'github:owner/repo#42';
const RUN_ID = 'artifact-run-1';

beforeAll(() => {
  db.run(sql`CREATE TABLE IF NOT EXISTS agent_artifacts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    artifact_key TEXT NOT NULL,
    project_id TEXT NOT NULL,
    work_item_id TEXT,
    run_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    summary TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    bytes INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    expires_at TEXT
  )`);
  db.run(
    sql`CREATE UNIQUE INDEX IF NOT EXISTS agent_artifacts_artifact_key_uniq
        ON agent_artifacts (artifact_key)`,
  );
  db.run(
    sql`CREATE INDEX IF NOT EXISTS agent_artifacts_project_work_item_idx
        ON agent_artifacts (project_id, work_item_id)`,
  );
  db.run(
    sql`CREATE INDEX IF NOT EXISTS agent_artifacts_run_id_idx
        ON agent_artifacts (run_id)`,
  );
  db.run(
    sql`CREATE INDEX IF NOT EXISTS agent_artifacts_project_work_item_run_kind_idx
        ON agent_artifacts (project_id, work_item_id, run_id, kind)`,
  );
});

beforeEach(() => {
  db.delete(agentArtifacts)
    .where(sql`project_id = ${PROJECT} OR project_id = ${OTHER_PROJECT}`)
    .run();
});

afterAll(() => {
  db.delete(agentArtifacts)
    .where(sql`project_id = ${PROJECT} OR project_id = ${OTHER_PROJECT}`)
    .run();
});

describe('agent artifact repository', () => {
  it('stores, fetches, and lists artifacts', () => {
    const ref = storeArtifact({
      projectId: PROJECT,
      workItemId: WORK_ITEM,
      runId: RUN_ID,
      kind: 'scout-report',
      summary: 'Scout report summary',
      payload: { findings: ['a'] },
      artifactKey: 'scout-report:test',
    });

    expect(ref).toMatchObject({
      artifactKey: 'scout-report:test',
      kind: 'scout-report',
      summary: 'Scout report summary',
      stored: true,
    });
    expect(ref.bytes).toBe(Buffer.byteLength(JSON.stringify({ findings: ['a'] }), 'utf8'));

    const fetched = getArtifact(ref.artifactKey);
    expect(fetched).toMatchObject({
      artifactKey: ref.artifactKey,
      projectId: PROJECT,
      workItemId: WORK_ITEM,
      runId: RUN_ID,
      kind: 'scout-report',
      summary: 'Scout report summary',
      payload: { findings: ['a'] },
    });

    expect(listArtifactsForRun(RUN_ID).map((a) => a.artifactKey)).toEqual([ref.artifactKey]);
    expect(listArtifactsForWorkItem(PROJECT, WORK_ITEM).map((a) => a.artifactKey)).toEqual([
      ref.artifactKey,
    ]);
  });

  it('upserts deterministic keys without duplicating rows', () => {
    const artifactKey = deterministicArtifactKey({
      projectId: PROJECT,
      workItemId: WORK_ITEM,
      runId: RUN_ID,
      kind: 'scout-report',
      discriminator: 'scout-schema',
    });

    storeArtifact({
      projectId: PROJECT,
      workItemId: WORK_ITEM,
      runId: RUN_ID,
      kind: 'scout-report',
      summary: 'First',
      payload: { value: 'first' },
      artifactKey,
    });
    const secondRef = storeArtifact({
      projectId: PROJECT,
      workItemId: WORK_ITEM,
      runId: RUN_ID,
      kind: 'scout-report',
      summary: 'Second',
      payload: { value: 'second' },
      artifactKey,
    });

    expect(secondRef.artifactKey).toBe(artifactKey);
    expect(listArtifactsForRun(RUN_ID)).toHaveLength(1);
    expect(getArtifact(artifactKey)).toMatchObject({
      summary: 'Second',
      payload: { value: 'second' },
      bytes: Buffer.byteLength(JSON.stringify({ value: 'second' }), 'utf8'),
    });
  });

  it('returns inline payloads under the explicit threshold', () => {
    const result = maybeStoreLargePayload({
      projectId: PROJECT,
      workItemId: WORK_ITEM,
      runId: RUN_ID,
      kind: 'small',
      summary: 'Small payload',
      payload: { ok: true },
      thresholdBytes: 1024,
    });

    expect(result).toEqual({ stored: false, payload: { ok: true } });
    expect(listArtifactsForRun(RUN_ID)).toEqual([]);
  });

  it('stores payloads over the explicit threshold', () => {
    const result = maybeStoreLargePayload({
      projectId: PROJECT,
      workItemId: WORK_ITEM,
      runId: RUN_ID,
      kind: 'large',
      summary: 'Large payload',
      payload: { body: 'x'.repeat(64) },
      thresholdBytes: 10,
      artifactKey: 'large:test',
    });

    expect(result).toMatchObject({
      stored: true,
      artifactKey: 'large:test',
      kind: 'large',
      summary: 'Large payload',
    });
    expect(getArtifact('large:test')?.payload).toEqual({ body: 'x'.repeat(64) });
  });

  it('returns bounded serialized payload slices without parsing the full artifact payload', () => {
    storeArtifact({
      projectId: PROJECT,
      workItemId: WORK_ITEM,
      runId: RUN_ID,
      kind: 'provider-evidence',
      summary: 'Provider evidence',
      payload: { body: 'abcdefghijklmnopqrstuvwxyz' },
      artifactKey: 'provider-evidence:test',
    });

    const slice = getArtifactSlice('provider-evidence:test', { offset: 9, limit: 10 });

    expect(slice).toMatchObject({
      artifactKey: 'provider-evidence:test',
      projectId: PROJECT,
      workItemId: WORK_ITEM,
      kind: 'provider-evidence',
      offset: 9,
      limit: 10,
      returnedBytes: 10,
      hasMore: true,
      payloadSlice: 'abcdefghij',
      encoding: 'json',
    });
    expect(slice).not.toHaveProperty('payload');
  });

  it('measures UTF-8 bytes rather than string length', () => {
    const payload = { value: '🙂' };
    const serialized = JSON.stringify(payload);

    expect(serialized.length).toBeLessThan(Buffer.byteLength(serialized, 'utf8'));

    const result = maybeStoreLargePayload({
      projectId: PROJECT,
      workItemId: WORK_ITEM,
      runId: RUN_ID,
      kind: 'utf8',
      summary: 'UTF-8 payload',
      payload,
      thresholdBytes: serialized.length,
      artifactKey: 'utf8:test',
    });

    expect(result).toMatchObject({ stored: true, artifactKey: 'utf8:test' });
  });

  it('redacts secrets before persistence and byte measurement', () => {
    const result = maybeStoreLargePayload({
      projectId: PROJECT,
      workItemId: WORK_ITEM,
      runId: RUN_ID,
      kind: 'secret',
      summary: 'Secret payload',
      payload: { token: 'Authorization: Bearer abcdefghijklmnopqrstuvwxyz' },
      thresholdBytes: 1,
      artifactKey: 'secret:test',
    });

    expect(result).toMatchObject({ stored: true, artifactKey: 'secret:test' });
    const artifact = getArtifact('secret:test');
    expect(artifact?.payload).toEqual({ token: 'Authorization: [REDACTED]' });
    expect(artifact?.bytes).toBe(
      Buffer.byteLength(JSON.stringify({ token: 'Authorization: [REDACTED]' }), 'utf8'),
    );
  });

  it('hides expired artifacts from fetch and list helpers', () => {
    storeArtifact({
      projectId: PROJECT,
      workItemId: WORK_ITEM,
      runId: RUN_ID,
      kind: 'expired',
      summary: 'Expired payload',
      payload: { old: true },
      artifactKey: 'expired:test',
      expiresAt: '2000-01-01T00:00:00Z',
    });

    expect(getArtifact('expired:test')).toBeNull();
    expect(listArtifactsForRun(RUN_ID)).toEqual([]);
    expect(listArtifactsForWorkItem(PROJECT, WORK_ITEM)).toEqual([]);
  });
});
