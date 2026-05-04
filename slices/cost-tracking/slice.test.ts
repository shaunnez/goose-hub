import { costFromApiUsage, costFromCliEnvelope } from '@goose-hub/core/cost/extract.js';
import {
  listCostsForWorkItem,
  recordCost,
  totalsByStageForProjectSince,
  totalsForProjectSince,
} from '@goose-hub/core/cost/repository.js';
import { stageForSkill } from '@goose-hub/core/cost/skill-stage.js';
import { db } from '@goose-hub/core/db/db.js';
import { agentRunCosts } from '@goose-hub/core/db/schema.js';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const PROJECT = 'cost-tracking-slice';

beforeAll(() => {
  db.run(sql`CREATE TABLE IF NOT EXISTS agent_run_costs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    work_item_id TEXT,
    stage TEXT NOT NULL,
    skill TEXT NOT NULL,
    model_id TEXT NOT NULL,
    input_tokens INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    cost_usd REAL NOT NULL DEFAULT 0,
    cost_label TEXT NOT NULL DEFAULT 'estimated',
    persona_id TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
  )`);
  db.run(
    sql`CREATE UNIQUE INDEX IF NOT EXISTS agent_run_costs_run_id_uniq ON agent_run_costs (run_id)`,
  );
});

beforeEach(() => {
  db.delete(agentRunCosts).where(sql`project_id = ${PROJECT}`).run();
});

afterAll(() => {
  db.delete(agentRunCosts).where(sql`project_id = ${PROJECT}`).run();
});

describe('cost-tracking slice — end-to-end lifecycle', () => {
  it('persists a row from a parsed Claude CLI envelope and reads it back', () => {
    // 1. Simulate a finished CLI run.
    const envelope = {
      result: '{"ok":true}',
      total_cost_usd: 0.073,
      usage: { input_tokens: 4200, output_tokens: 1300 },
    };
    const usage = costFromCliEnvelope(envelope);
    expect(usage).not.toBeNull();
    if (!usage) return;

    // 2. Persist (mirroring what claude-cli.ts does on success).
    recordCost({
      runId: 'slice-run-1',
      projectId: PROJECT,
      workItemId: 'github:owner/repo#42',
      stage: stageForSkill('qa'),
      skill: 'qa',
      modelId: 'claude-sonnet-4-6',
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      costUsd: usage.costUsd,
      costLabel: usage.costLabel,
      personaId: 'p1',
    });

    // 3. Read back by work item — UI's per-task surface uses this path.
    const rows = listCostsForWorkItem('github:owner/repo#42');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      runId: 'slice-run-1',
      stage: 'qa',
      skill: 'qa',
      modelId: 'claude-sonnet-4-6',
      inputTokens: 4200,
      outputTokens: 1300,
      costLabel: 'estimated',
    });
    expect(rows[0].costUsd).toBeCloseTo(0.073);

    // 4. Aggregate by stage — the dashboard's per-stage chart uses this.
    const totals = totalsForProjectSince(PROJECT, '1970-01-01T00:00:00Z');
    expect(totals.totalRuns).toBe(1);
    expect(totals.totalUsd).toBeCloseTo(0.073);
    expect(totals.hasEstimated).toBe(true);

    const stages = totalsByStageForProjectSince(PROJECT, '1970-01-01T00:00:00Z');
    expect(stages).toHaveLength(1);
    expect(stages[0].stage).toBe('qa');
    expect(stages[0].totalUsd).toBeCloseTo(0.073);
  });

  it('records a zero-cost row when the CLI envelope has no usage data', () => {
    // No usage / no cost — we still want the run to appear on the dashboard.
    recordCost({
      runId: 'slice-run-2',
      projectId: PROJECT,
      workItemId: 'github:owner/repo#43',
      stage: stageForSkill('triage'),
      skill: 'triage',
      modelId: 'claude-haiku-4-5-20251001',
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
      costLabel: 'estimated',
      personaId: null,
    });

    const rows = listCostsForWorkItem('github:owner/repo#43');
    expect(rows).toHaveLength(1);
    expect(rows[0].costUsd).toBe(0);
    expect(rows[0].costLabel).toBe('estimated');
  });

  it('propagates the exact label end-to-end when authoritative usage metadata is supplied', () => {
    // Direct API integration — the caller computed the dollar figure from
    // authoritative `usage.input_tokens` / `output_tokens`, so the row must
    // be tagged 'exact' and read back that way.
    const usage = costFromApiUsage({ inputTokens: 800, outputTokens: 200, costUsd: 0.018 });
    expect(usage.costLabel).toBe('exact');

    recordCost({
      runId: 'slice-run-exact',
      projectId: PROJECT,
      workItemId: 'github:owner/repo#99',
      stage: stageForSkill('review'),
      skill: 'review',
      modelId: 'claude-sonnet-4-6',
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      costUsd: usage.costUsd,
      costLabel: usage.costLabel,
      personaId: null,
    });

    const rows = listCostsForWorkItem('github:owner/repo#99');
    expect(rows).toHaveLength(1);
    expect(rows[0].costLabel).toBe('exact');

    // Aggregations must reflect that the project window has at least one
    // exact row → `hasEstimated` flips to false when the row is exact.
    const totals = totalsForProjectSince(PROJECT, '1970-01-01T00:00:00Z');
    expect(totals.hasEstimated).toBe(false);
  });

  it('is idempotent on runId — replay does not double-count', () => {
    const base = {
      runId: 'slice-run-3',
      projectId: PROJECT,
      workItemId: 'github:owner/repo#44',
      stage: 'dev' as const,
      skill: 'implement',
      modelId: 'claude-sonnet-4-6',
      inputTokens: 1000,
      outputTokens: 500,
      costUsd: 0.02,
      costLabel: 'estimated' as const,
      personaId: null,
    };
    recordCost(base);
    recordCost(base);
    recordCost({ ...base, costUsd: 999 });

    const rows = listCostsForWorkItem('github:owner/repo#44');
    expect(rows).toHaveLength(1);
    expect(rows[0].costUsd).toBeCloseTo(0.02);
  });
});
