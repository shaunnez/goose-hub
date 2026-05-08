import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../../core/db/db.js';
import { agentDecisions } from '../../core/db/schema.js';
import { computeAllowlist } from '../../core/tool-layer/allowlist.js';
import { readRunDecisions, recordDecision } from '../../core/tool-layer/tools/record-decision.js';

const RUN_A = 'test-record-decision-run-a';
const RUN_B = 'test-record-decision-run-b';

// ─── setup ────────────────────────────────────────────────────────────────────

beforeAll(() => {
  db.run(sql`CREATE TABLE IF NOT EXISTS agent_decisions (
    id TEXT PRIMARY KEY NOT NULL,
    run_id TEXT NOT NULL,
    iteration INTEGER NOT NULL DEFAULT 0,
    phase TEXT NOT NULL DEFAULT '',
    kind TEXT NOT NULL,
    what TEXT NOT NULL,
    why TEXT NOT NULL,
    ts TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
  )`);
  db.run(sql`CREATE UNIQUE INDEX IF NOT EXISTS agent_decisions_run_kind_what_uniq
    ON agent_decisions (run_id, kind, what)`);
  db.run(sql`CREATE INDEX IF NOT EXISTS agent_decisions_run_idx
    ON agent_decisions (run_id)`);

  // Clean up any stale test rows from prior runs
  db.delete(agentDecisions).where(sql`run_id IN (${RUN_A}, ${RUN_B})`).run();
});

afterAll(() => {
  db.delete(agentDecisions).where(sql`run_id IN (${RUN_A}, ${RUN_B})`).run();
});

// ─── recordDecision ───────────────────────────────────────────────────────────

describe('recordDecision', () => {
  it('records a valid decision and returns recorded: true', () => {
    const result = recordDecision({
      runId: RUN_A,
      kind: 'PLAN',
      what: 'chose TDD',
      why: 'faster feedback',
    });
    expect(result.recorded).toBe(true);
    expect(typeof result.id).toBe('string');
    expect(result.id.length).toBeGreaterThan(0);
  });

  it('coerces unknown kind to UNKNOWN', () => {
    const result = recordDecision({
      runId: RUN_A,
      kind: 'NOT_A_REAL_KIND',
      what: 'mystery',
      why: 'test',
    });
    expect(result.recorded).toBe(true);

    const rows = db
      .select({ kind: agentDecisions.kind })
      .from(agentDecisions)
      .where(sql`run_id = ${RUN_A} AND what = 'mystery'`)
      .all();
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe('UNKNOWN');
  });

  it('deduplicates on (runId, kind, what) — second call returns recorded: false', () => {
    const first = recordDecision({
      runId: RUN_A,
      kind: 'READ',
      what: 'opened handler',
      why: 'initial',
    });
    expect(first.recorded).toBe(true);

    const second = recordDecision({
      runId: RUN_A,
      kind: 'READ',
      what: 'opened handler',
      why: 'different why',
    });
    expect(second.recorded).toBe(false);
    if (!second.recorded) {
      expect(second.reason).toBe('duplicate');
      expect(second.id).toBe(first.id);
    }
  });

  it('allows the same (kind, what) for a different runId', () => {
    recordDecision({ runId: RUN_A, kind: 'GREEN', what: 'tests pass', why: 'run A' });
    const result = recordDecision({
      runId: RUN_B,
      kind: 'GREEN',
      what: 'tests pass',
      why: 'run B',
    });
    expect(result.recorded).toBe(true);
  });

  it('persists iteration and phase metadata', () => {
    recordDecision({
      runId: RUN_B,
      kind: 'REFACTOR',
      what: 'extracted helper',
      why: 'DRY',
      iteration: 2,
      phase: 'implement',
    });
    const rows = db
      .select({ iteration: agentDecisions.iteration, phase: agentDecisions.phase })
      .from(agentDecisions)
      .where(sql`run_id = ${RUN_B} AND what = 'extracted helper'`)
      .all();
    expect(rows[0].iteration).toBe(2);
    expect(rows[0].phase).toBe('implement');
  });
});

// ─── readRunDecisions ─────────────────────────────────────────────────────────

describe('readRunDecisions', () => {
  it('returns all decisions for a run as DecisionSummary-shaped objects', () => {
    const decisions = readRunDecisions(RUN_A);
    expect(decisions.length).toBeGreaterThan(0);
    for (const d of decisions) {
      expect(typeof d.kind).toBe('string');
      expect(typeof d.summary).toBe('string');
    }
  });

  it('returns empty array for an unknown runId', () => {
    const decisions = readRunDecisions('run-that-does-not-exist');
    expect(decisions).toHaveLength(0);
  });

  it('maps what → summary and why → evidence', () => {
    const runId = 'test-map-run';
    db.delete(agentDecisions).where(sql`run_id = ${runId}`).run();
    recordDecision({ runId, kind: 'COMMIT', what: 'committed fix', why: 'all tests green' });

    const decisions = readRunDecisions(runId);
    expect(decisions).toHaveLength(1);
    expect(decisions[0].summary).toBe('committed fix');
    expect(decisions[0].evidence).toBe('all tests green');

    db.delete(agentDecisions).where(sql`run_id = ${runId}`).run();
  });
});

// ─── holdout role blocked bundle ──────────────────────────────────────────────

describe('holdout role denied bundle assignment', () => {
  it('qa role does not receive record-decision from decision-record-only bundle', () => {
    const list = computeAllowlist({
      toolBundles: ['decision-record-only'],
      toolExtras: [],
      role: 'qa',
    });
    expect(list).not.toContain('record-decision');
  });

  it('reviewer role does not receive record-decision from decision-record-only bundle', () => {
    const list = computeAllowlist({
      toolBundles: ['decision-record-only'],
      toolExtras: [],
      role: 'reviewer',
    });
    expect(list).not.toContain('record-decision');
  });

  it('developer role receives record-decision from decision-record-only bundle', () => {
    const list = computeAllowlist({
      toolBundles: ['decision-record-only'],
      toolExtras: [],
      role: 'developer',
    });
    expect(list).toContain('record-decision');
  });

  it('investigator role receives record-decision from decision-record-only bundle', () => {
    const list = computeAllowlist({
      toolBundles: ['decision-record-only'],
      toolExtras: [],
      role: 'investigator',
    });
    expect(list).toContain('record-decision');
  });
});

// ─── flag-off fallback ────────────────────────────────────────────────────────

describe('flag-off behaviour', () => {
  it('decision-record-only excluded from bundles when flag not set', () => {
    // When the flag is off, the orchestrator simply does not add 'decision-record-only'
    // to the toolBundles list. computeAllowlist returns nothing for it in that case.
    const listWithout = computeAllowlist({ toolBundles: ['dev-tools'], toolExtras: [] });
    expect(listWithout).not.toContain('record-decision');
  });

  it('readRunDecisions returns empty when no tool calls were made (flag-off run)', () => {
    const decisions = readRunDecisions('flag-off-run-no-decisions');
    expect(decisions).toHaveLength(0);
  });
});
