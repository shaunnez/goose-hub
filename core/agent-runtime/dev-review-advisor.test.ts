import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { getArtifact } from '../agent-artifacts/repository.js';
import { db } from '../db/db.js';
import { agentArtifacts } from '../db/schema.js';
import { preparePrDiffContext } from './dev-review-advisor.js';
import { buildDiffDigest } from './diff-digest.js';

const PROJECT = 'test-dev-review-artifacts';
const WORK_ITEM = 'github:owner/repo#77';
const RUN_ID = 'dev-review-run';

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

describe('preparePrDiffContext', () => {
  it('keeps small diffs inline with a digest first', () => {
    const diff = 'diff --git a/src/a.ts b/src/a.ts\n+++ b/src/a.ts\n+export const a = 1;\n';

    const result = preparePrDiffContext({
      projectId: PROJECT,
      workItemId: WORK_ITEM,
      runId: RUN_ID,
      prDiff: diff,
      thresholdBytes: 1024,
    });

    expect(result.prDiffContext).toContain('PR diff digest:');
    expect(result.prDiffContext).toContain('Full PR diff kept inline');
    expect(result.prDiffContext).toContain(diff);
    expect(result.artifactRef).toBeUndefined();
    expect(result.changedFiles).toEqual(['src/a.ts']);
    expect(result.digest).toEqual(buildDiffDigest(diff));
    expect(result.disclosure).toBeUndefined();
  });

  it('stores large diffs and replaces prompt context with a digest and artifact key', () => {
    const diff = [
      'diff --git a/src/a.ts b/src/a.ts',
      '--- a/src/a.ts',
      '+++ b/src/a.ts',
      '@@ -1 +1 @@',
      `+${'x'.repeat(256)}`,
    ].join('\n');

    const result = preparePrDiffContext({
      projectId: PROJECT,
      workItemId: WORK_ITEM,
      runId: RUN_ID,
      prDiff: diff,
      thresholdBytes: 50,
    });

    expect(result.artifactRef).toMatchObject({
      kind: 'pr-diff',
      summary: expect.stringContaining('1 changed files: src/a.ts'),
      stored: true,
    });
    expect(result.prDiffContext).toContain('PR diff digest:');
    expect(result.prDiffContext).toContain('Full PR diff omitted');
    expect(result.prDiffContext).toContain('ArtifactRef:');
    expect(result.prDiffContext).toContain('src/a.ts');
    expect(result.prDiffContext).not.toContain('x'.repeat(128));
    expect(getArtifact(result.artifactRef?.artifactKey ?? '')?.payload).toBe(diff);
    expect(result.digest.artifactKey).toBe(result.artifactRef?.artifactKey);
    expect(result.disclosure).toMatchObject({
      kind: 'diff_summarized',
      artifactKeys: [result.artifactRef?.artifactKey],
    });
  });

  it('uses deterministic upsert for the same run and diff', () => {
    const diff = `diff --git a/src/a.ts b/src/a.ts\n+++ b/src/a.ts\n+${'x'.repeat(256)}`;

    const first = preparePrDiffContext({
      projectId: PROJECT,
      workItemId: WORK_ITEM,
      runId: RUN_ID,
      prDiff: diff,
      thresholdBytes: 50,
    });
    const second = preparePrDiffContext({
      projectId: PROJECT,
      workItemId: WORK_ITEM,
      runId: RUN_ID,
      prDiff: diff,
      thresholdBytes: 50,
    });

    expect(second.artifactRef?.artifactKey).toBe(first.artifactRef?.artifactKey);
    expect(db.select().from(agentArtifacts).where(sql`project_id = ${PROJECT}`).all()).toHaveLength(
      1,
    );
  });
});
