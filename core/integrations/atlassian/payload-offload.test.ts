import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { getArtifact } from '../../agent-artifacts/repository.js';
import { db } from '../../db/db.js';
import { agentArtifacts } from '../../db/schema.js';
import { offloadAtlassianPayload } from './payload-offload.js';

const PROJECT = 'atlassian-offload-test';
const WORK_ITEM = 'local:atlassian-offload-test#1';
const RUN_ID = 'atlassian-run-1';

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
});

beforeEach(() => {
  db.delete(agentArtifacts).where(sql`project_id = ${PROJECT}`).run();
});

afterAll(() => {
  db.delete(agentArtifacts).where(sql`project_id = ${PROJECT}`).run();
});

describe('Atlassian payload offload', () => {
  it('stores large provider payloads as summaries plus artifact refs', () => {
    const result = offloadAtlassianPayload({
      projectId: PROJECT,
      workItemId: WORK_ITEM,
      runId: RUN_ID,
      provider: 'jira',
      tier: 'evidence',
      resourceId: 'TAS-123',
      userFacingArgs: {
        key: 'TAS-123',
        include: ['comments', 'history'],
      },
      payload: {
        comments: ['x'.repeat(128)],
        raw: { fields: { description: 'x'.repeat(128) } },
      },
      summary: 'Jira TAS-123 evidence: comments and history stored as artifact',
      thresholdBytes: 10,
    });

    expect(result).toMatchObject({
      stored: true,
      summary: 'Jira TAS-123 evidence: comments and history stored as artifact',
      artifactRef: {
        stored: true,
        kind: 'atlassian:jira:evidence:TAS-123',
      },
    });
    expect(result).not.toHaveProperty('payload');
    expect(result.artifactRef?.artifactKey).toMatch(/^atlassian:jira:evidence:TAS-123:/);
    expect(getArtifact(result.artifactRef?.artifactKey ?? '')?.payload).toMatchObject({
      raw: { fields: { description: expect.any(String) } },
    });
  });

  it('derives deterministic artifact keys from provider, tier, resource, and user-facing args', () => {
    const first = offloadAtlassianPayload({
      projectId: PROJECT,
      workItemId: WORK_ITEM,
      runId: RUN_ID,
      provider: 'bitbucket',
      tier: 'detail',
      resourceId: 'company/api#45',
      userFacingArgs: { repo: 'api', pullRequest: '45' },
      payload: { body: 'x'.repeat(64) },
      summary: 'Bitbucket PR detail',
      thresholdBytes: 1,
    });
    const second = offloadAtlassianPayload({
      projectId: PROJECT,
      workItemId: WORK_ITEM,
      runId: RUN_ID,
      provider: 'bitbucket',
      tier: 'detail',
      resourceId: 'company/api#45',
      userFacingArgs: { pullRequest: '45', repo: 'api' },
      payload: { body: 'changed' },
      summary: 'Bitbucket PR detail',
      thresholdBytes: 1,
    });

    expect(first.artifactRef?.artifactKey).toBe(second.artifactRef?.artifactKey);
  });
});
