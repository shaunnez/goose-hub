import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getArtifact } from '../agent-artifacts/repository.js';
import { db } from '../db/db.js';
import { agentArtifacts } from '../db/schema.js';
import { preparePrDiffContext, runDevReviewResponse } from './dev-review-advisor.js';
import { buildDiffDigest } from './diff-digest.js';
import type { AgentSpec } from './interface.js';

const runtimeCalls = vi.hoisted(() => ({
  codex: [] as AgentSpec[],
  claude: [] as AgentSpec[],
}));

vi.mock('../projects/loader.js', () => ({
  getProjectBySlug: vi.fn().mockResolvedValue({
    id: 'test-dev-review-artifacts',
    slug: 'test-dev-review-artifacts',
    agentConfig: { runtime: 'auto' },
  }),
}));

vi.mock('../db/repositories/project-settings.js', () => ({
  readProjectSettings: vi.fn().mockReturnValue(null),
  readProjectSkillSettings: vi.fn().mockReturnValue(
    new Map([
      [
        'dev-review-response',
        {
          projectId: 'test-dev-review-artifacts',
          skillName: 'dev-review-response',
          modelProvider: 'codex',
          modelTier: null,
          maxTurns: null,
          maxBudgetUsd: null,
          timeoutMs: null,
          effort: null,
          updatedAt: '2026-05-22T00:00:00.000Z',
          updatedBy: 'test',
        },
      ],
    ]),
  ),
}));

vi.mock('./select-persona.js', () => ({
  selectPersona: vi.fn().mockReturnValue({
    personaId: 'test-dev-review-artifacts/developer/0',
    codename: 'Test Developer',
  }),
}));

vi.mock('./codex-cli.js', () => ({
  CodexCliRuntime: class {
    async run(spec: AgentSpec) {
      runtimeCalls.codex.push(spec);
      return {
        output: {
          findingDispositions: [
            {
              findingRef: 'src/a.ts:1',
              severity: 'P1',
              disposition: 'dismissed',
              reason: 'Not applicable in test fixture',
            },
          ],
          decisionSummaries: [
            {
              kind: 'DEV_REVIEW_DISMISSED',
              summary: 'Dismissed P1 test finding at src/a.ts:1',
              evidence: 'src/a.ts:1',
            },
          ],
        },
        decisionSummaries: [],
        events: [],
      };
    }
  },
}));

vi.mock('./claude-cli.js', () => ({
  ClaudeCliRuntime: class {
    async run(spec: AgentSpec) {
      runtimeCalls.claude.push(spec);
      return {
        output: {
          findingDispositions: [],
          decisionSummaries: [
            {
              kind: 'DEV_REVIEW_DISMISSED',
              summary: 'Claude should not run for this test',
            },
          ],
        },
        decisionSummaries: [],
        events: [],
      };
    }
  },
}));

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
  runtimeCalls.codex.length = 0;
  runtimeCalls.claude.length = 0;
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

describe('runDevReviewResponse runtime resolution', () => {
  it('honours project skill provider settings when no runtime is injected', async () => {
    await runDevReviewResponse({
      runId: RUN_ID,
      projectId: PROJECT,
      workItemId: WORK_ITEM,
      workItem: { title: 'Fix ordering', body: 'body', number: 77, priority: 'high' },
      prDiff: 'diff --git a/src/a.ts b/src/a.ts\n+++ b/src/a.ts\n+export const a = 1;\n',
      devReviewFindings: [
        {
          severity: 'P1',
          category: 'correctness',
          file: 'src/a.ts',
          line: 1,
          summary: 'Broken behavior',
          suggestion: 'Fix it',
        },
      ],
      worktreePath: '/tmp/dev-review-response-worktree',
      appendEvent: (input) => ({
        ...input,
        workItemId: input.workItemId ?? null,
        id: 1,
        createdAt: new Date().toISOString(),
      }),
    });

    expect(runtimeCalls.codex).toHaveLength(1);
    expect(runtimeCalls.claude).toHaveLength(0);
    expect(runtimeCalls.codex[0]).toMatchObject({
      skill: 'dev-review-response',
      role: 'developer',
      modelOverride: 'gpt-5.4',
      workspaceDir: '/tmp/dev-review-response-worktree',
    });
  });
});
