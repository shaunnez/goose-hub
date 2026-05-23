import { like, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { db } from '../db/db.js';
import { agentRunCosts, agentRunToolStats, events } from '../db/schema.js';
import { eventStore } from '../event-stream/store.js';
import {
  listToolStatsForWorkItem,
  listCostsForWorkItem,
  recordCost,
  recordToolStatsForRun,
  totalSpendForSkill,
  totalsByStageForProjectSince,
  totalsForProjectSince,
} from './repository.js';

const PROJECT = 'test-cost-repo';

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
  db.run(sql`CREATE TABLE IF NOT EXISTS agent_run_tool_stats (
    run_id TEXT PRIMARY KEY,
    read_count INTEGER NOT NULL DEFAULT 0,
    grep_count INTEGER NOT NULL DEFAULT 0,
    write_count INTEGER NOT NULL DEFAULT 0,
    edit_count INTEGER NOT NULL DEFAULT 0,
    bytes_read INTEGER NOT NULL DEFAULT 0,
    unique_paths_read INTEGER NOT NULL DEFAULT 0,
    redundant_reads INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
  )`);
});

beforeEach(() => {
  db.delete(agentRunCosts).where(sql`project_id = ${PROJECT}`).run();
  db.delete(agentRunToolStats)
    .where(like(agentRunToolStats.runId, `${PROJECT}:%`))
    .run();
  db.delete(events).where(sql`project_id = ${PROJECT}`).run();
});

afterAll(() => {
  db.delete(agentRunCosts).where(sql`project_id = ${PROJECT}`).run();
  db.delete(agentRunToolStats)
    .where(like(agentRunToolStats.runId, `${PROJECT}:%`))
    .run();
  db.delete(events).where(sql`project_id = ${PROJECT}`).run();
});

describe('recordCost', () => {
  it('persists a single cost row', () => {
    recordCost({
      runId: `run-1-${PROJECT}`,
      projectId: PROJECT,
      workItemId: 'github:owner/repo#42',
      stage: 'qa',
      skill: 'qa',
      modelId: 'claude-sonnet-4-6',
      inputTokens: 1000,
      outputTokens: 500,
      costUsd: 0.012,
      costLabel: 'estimated',
      personaId: 'p1',
    });

    const rows = listCostsForWorkItem('github:owner/repo#42');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      runId: `run-1-${PROJECT}`,
      stage: 'qa',
      skill: 'qa',
      costUsd: 0.012,
      costLabel: 'estimated',
    });
  });

  it('is idempotent on runId — duplicate insert is silently ignored', () => {
    const runId = `run-dup-${PROJECT}`;
    const base = {
      runId,
      projectId: PROJECT,
      workItemId: 'github:owner/repo#1',
      stage: 'qa' as const,
      skill: 'qa',
      modelId: 'claude-sonnet-4-6',
      inputTokens: 100,
      outputTokens: 50,
      costUsd: 0.001,
      costLabel: 'estimated' as const,
      personaId: null,
    };
    recordCost(base);
    recordCost({ ...base, costUsd: 99 }); // would otherwise overwrite

    const rows = listCostsForWorkItem('github:owner/repo#1');
    expect(rows).toHaveLength(1);
    expect(rows[0].costUsd).toBe(0.001);
  });
});

describe('recordToolStatsForRun', () => {
  it('aggregates read/search/write/edit calls and detects repeated read paths within one run', () => {
    const runId = `${PROJECT}:tool-stats-run`;
    recordCost({
      runId,
      projectId: PROJECT,
      workItemId: 'github:owner/repo#99',
      stage: 'dev',
      skill: 'implement',
      modelId: 'claude-sonnet-4-6',
      inputTokens: 100,
      outputTokens: 10,
      costUsd: 0.2,
      costLabel: 'estimated',
      personaId: null,
    });
    appendTool(runId, 'read_file', 'src/a.ts', { bytesRead: 120 });
    appendTool(runId, 'search_text', null);
    appendTool(runId, 'read_file', 'src/a.ts', { bytesRead: 120 });
    appendTool(runId, 'read_file', 'src/b.ts', { bytesRead: 80 });
    appendTool(runId, 'write_file', 'src/b.ts');
    appendTool(runId, 'edit_file', 'src/c.ts');

    const stats = recordToolStatsForRun(runId);

    expect(stats).toMatchObject({
      runId,
      readCount: 3,
      grepCount: 1,
      writeCount: 1,
      editCount: 1,
      bytesRead: 320,
      uniquePathsRead: 2,
      redundantReads: 1,
    });

    const [joined] = listToolStatsForWorkItem('github:owner/repo#99');
    expect(joined).toMatchObject({
      runId,
      skill: 'implement',
      costUsd: 0.2,
      readCount: 3,
      bytesRead: 320,
      redundantReads: 1,
    });
  });

  it('keeps run stats idempotent when aggregation is called more than once', () => {
    const runId = `${PROJECT}:tool-stats-idempotent`;
    recordCost({
      runId,
      projectId: PROJECT,
      workItemId: 'github:owner/repo#100',
      stage: 'qa',
      skill: 'qa',
      modelId: 'gpt-5.4',
      inputTokens: 100,
      outputTokens: 10,
      costUsd: 0.2,
      costLabel: 'estimated',
      personaId: null,
    });
    appendTool(runId, 'Read', 'src/a.ts', { bytes_read: 12 });

    recordToolStatsForRun(runId);
    const stats = recordToolStatsForRun(runId);

    expect(stats.readCount).toBe(1);
    expect(listToolStatsForWorkItem('github:owner/repo#100')).toHaveLength(1);
  });

  it('emits a tool-intensity anomaly when read count exceeds twice the skill p95 baseline', () => {
    const baselineRunId = `${PROJECT}:baseline`;
    recordCost({
      runId: baselineRunId,
      projectId: PROJECT,
      workItemId: 'github:owner/repo#101',
      stage: 'dev',
      skill: 'implement',
      modelId: 'gpt-5.4',
      inputTokens: 100,
      outputTokens: 10,
      costUsd: 0.2,
      costLabel: 'estimated',
      personaId: null,
    });
    appendTool(baselineRunId, 'read_file', 'src/a.ts');
    appendTool(baselineRunId, 'read_file', 'src/b.ts');
    recordToolStatsForRun(baselineRunId);

    const runId = `${PROJECT}:anomaly`;
    recordCost({
      runId,
      projectId: PROJECT,
      workItemId: 'github:owner/repo#102',
      stage: 'dev',
      skill: 'implement',
      modelId: 'gpt-5.4',
      inputTokens: 100,
      outputTokens: 10,
      costUsd: 0.2,
      costLabel: 'estimated',
      personaId: null,
    });
    for (let index = 0; index < 5; index += 1) {
      appendTool(runId, 'read_file', `src/high-${index}.ts`);
    }

    recordToolStatsForRun(runId);

    const [event] = eventStore.replay({ runId, kind: 'agent.tool-intensity-anomaly' });
    expect(event?.payload).toMatchObject({
      runId,
      skill: 'implement',
      readCount: 5,
      p95ReadCount: 2,
      thresholdReadCount: 4,
    });
  });
});

describe('totalsForProjectSince', () => {
  it('sums costs and flags estimated when any row is estimated', () => {
    recordCost({
      runId: `run-a-${PROJECT}`,
      projectId: PROJECT,
      workItemId: null,
      stage: 'qa',
      skill: 'qa',
      modelId: 'claude-sonnet-4-6',
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0.5,
      costLabel: 'estimated',
      personaId: null,
    });
    recordCost({
      runId: `run-b-${PROJECT}`,
      projectId: PROJECT,
      workItemId: null,
      stage: 'review',
      skill: 'review',
      modelId: 'claude-sonnet-4-6',
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0.25,
      costLabel: 'exact',
      personaId: null,
    });

    const totals = totalsForProjectSince(PROJECT, '1970-01-01T00:00:00Z');
    expect(totals.totalUsd).toBeCloseTo(0.75);
    expect(totals.totalRuns).toBe(2);
    expect(totals.hasEstimated).toBe(true);
  });

  it('flags hasEstimated=false when every row is exact', () => {
    recordCost({
      runId: `run-c-${PROJECT}`,
      projectId: PROJECT,
      workItemId: null,
      stage: 'qa',
      skill: 'qa',
      modelId: 'claude-sonnet-4-6',
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0.5,
      costLabel: 'exact',
      personaId: null,
    });
    const totals = totalsForProjectSince(PROJECT, '1970-01-01T00:00:00Z');
    expect(totals.hasEstimated).toBe(false);
  });
});

describe('totalSpendForSkill', () => {
  it('returns 0 when no rows exist for the given skill', () => {
    const total = totalSpendForSkill(PROJECT, 'advise-on-prd');
    expect(total).toBe(0);
  });

  it('sums costs only for the specified skill', () => {
    recordCost({
      runId: `run-skill-a-${PROJECT}`,
      projectId: PROJECT,
      workItemId: null,
      stage: 'discover',
      skill: 'advise-on-prd',
      modelId: 'claude-opus-4-5',
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0.5,
      costLabel: 'exact',
      personaId: null,
    });
    recordCost({
      runId: `run-skill-b-${PROJECT}`,
      projectId: PROJECT,
      workItemId: null,
      stage: 'discover',
      skill: 'write-prd',
      modelId: 'claude-opus-4-5',
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 1.0,
      costLabel: 'exact',
      personaId: null,
    });
    const total = totalSpendForSkill(PROJECT, 'advise-on-prd');
    expect(total).toBeCloseTo(0.5);
  });

  it('returns 0 when the project has no rows (even if another project does)', () => {
    recordCost({
      runId: `run-other-proj-${PROJECT}`,
      projectId: 'other-project',
      workItemId: null,
      stage: 'discover',
      skill: 'advise-on-prd',
      modelId: 'claude-opus-4-5',
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 2.0,
      costLabel: 'exact',
      personaId: null,
    });
    const total = totalSpendForSkill(PROJECT, 'advise-on-prd');
    expect(total).toBe(0);
  });
});

describe('totalsByStageForProjectSince', () => {
  it('groups totals by stage and orders by spend descending', () => {
    recordCost({
      runId: `run-s1-${PROJECT}`,
      projectId: PROJECT,
      workItemId: null,
      stage: 'dev',
      skill: 'implement',
      modelId: 'claude-sonnet-4-6',
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 1.0,
      costLabel: 'estimated',
      personaId: null,
    });
    recordCost({
      runId: `run-s2-${PROJECT}`,
      projectId: PROJECT,
      workItemId: null,
      stage: 'qa',
      skill: 'qa',
      modelId: 'claude-sonnet-4-6',
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0.3,
      costLabel: 'estimated',
      personaId: null,
    });
    const stages = totalsByStageForProjectSince(PROJECT, '1970-01-01T00:00:00Z');
    expect(stages.map((s) => s.stage)).toEqual(['dev', 'qa']);
    expect(stages[0].totalUsd).toBeCloseTo(1.0);
    expect(stages[1].totalUsd).toBeCloseTo(0.3);
  });
});

function appendTool(
  runId: string,
  toolName: string,
  path: string | null,
  extra: Record<string, unknown> = {},
): void {
  eventStore.appendEvent({
    projectId: PROJECT,
    workItemId: 'github:owner/repo#99',
    runId,
    kind: 'agent.tool-call',
    payload: {
      tool_name: toolName,
      tool_input: path == null ? {} : { path },
      ...(path == null ? {} : { canonical_path: { path } }),
      ...extra,
    },
  });
}
