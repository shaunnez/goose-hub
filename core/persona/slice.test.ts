import { beforeEach, describe, expect, it, vi } from 'vitest';
import { accumulatePersonaStats } from './accumulate.js';

// ─── DB mock ─────────────────────────────────────────────────────────────────

const rows: Array<{
  personaName: string;
  role: string;
  runsTotal: number;
  runsSucceeded: number;
  runsFailed: number;
  avgQualityScore: number;
  lastRunAt: string;
}> = [];

const { mockDb } = vi.hoisted(() => {
  const mockDb = {
    select: vi.fn(),
    from: vi.fn(),
    where: vi.fn(),
    insert: vi.fn(),
    values: vi.fn(),
    update: vi.fn(),
    set: vi.fn(),
    run: vi.fn(),
  };
  mockDb.select.mockReturnValue(mockDb);
  mockDb.from.mockReturnValue(mockDb);
  mockDb.where.mockReturnValue({ all: vi.fn(() => []) });
  mockDb.insert.mockReturnValue(mockDb);
  mockDb.values.mockReturnValue({ run: vi.fn() });
  mockDb.update.mockReturnValue(mockDb);
  mockDb.set.mockReturnValue(mockDb);
  return { mockDb };
});

vi.mock('../db/db.js', () => ({ db: mockDb }));
vi.mock('../db/schema.js', () => ({
  personaStats: { personaName: 'persona_name', role: 'role' },
}));

beforeEach(() => {
  rows.length = 0;
  vi.clearAllMocks();
  mockDb.select.mockReturnValue(mockDb);
  mockDb.from.mockReturnValue(mockDb);
  mockDb.where.mockReturnValue({ all: vi.fn(() => rows) });
  mockDb.insert.mockReturnValue(mockDb);
  mockDb.values.mockReturnValue({ run: vi.fn() });
  mockDb.update.mockReturnValue(mockDb);
  mockDb.set.mockReturnValue(mockDb);
});

// ─── accumulate tests ─────────────────────────────────────────────────────────

describe('accumulatePersonaStats', () => {
  it('inserts a new row on first run for a persona', () => {
    const insertRunFn = vi.fn();
    mockDb.where.mockReturnValueOnce({ all: vi.fn().mockReturnValue([]) });
    mockDb.values.mockReturnValueOnce({ run: insertRunFn });

    accumulatePersonaStats({ personaName: 'alice', role: 'developer', outcome: 'success' });

    expect(insertRunFn).toHaveBeenCalledTimes(1);
  });

  it('increments runs_total and runs_succeeded on success', () => {
    const existing = {
      personaName: 'alice',
      role: 'developer',
      runsTotal: 2,
      runsSucceeded: 2,
      runsFailed: 0,
      avgQualityScore: 1.0,
      lastRunAt: '2026-05-01T00:00:00.000Z',
    };
    rows.push(existing);
    mockDb.where.mockReturnValueOnce({ all: vi.fn().mockReturnValue([existing]) });
    const updateRunFn = vi.fn();
    mockDb.set.mockReturnValueOnce({ where: vi.fn().mockReturnValue({ run: updateRunFn }) });

    accumulatePersonaStats({ personaName: 'alice', role: 'developer', outcome: 'success' });

    expect(updateRunFn).toHaveBeenCalledTimes(1);
    const updateArg = mockDb.set.mock.calls[0][0] as {
      runsTotal: number;
      runsSucceeded: number;
      runsFailed: number;
    };
    expect(updateArg.runsTotal).toBe(3);
    expect(updateArg.runsSucceeded).toBe(3);
    expect(updateArg.runsFailed).toBe(0);
  });

  it('increments runs_total and runs_failed on failure', () => {
    const existing = {
      personaName: 'bob',
      role: 'qa',
      runsTotal: 1,
      runsSucceeded: 1,
      runsFailed: 0,
      avgQualityScore: 0.9,
      lastRunAt: '2026-05-01T00:00:00.000Z',
    };
    rows.push(existing);
    mockDb.where.mockReturnValueOnce({ all: vi.fn().mockReturnValue([existing]) });
    mockDb.set.mockReturnValueOnce({ where: vi.fn().mockReturnValue({ run: vi.fn() }) });

    accumulatePersonaStats({ personaName: 'bob', role: 'qa', outcome: 'failure' });

    const updateArg = mockDb.set.mock.calls[0][0] as {
      runsTotal: number;
      runsSucceeded: number;
      runsFailed: number;
    };
    expect(updateArg.runsTotal).toBe(2);
    expect(updateArg.runsSucceeded).toBe(1);
    expect(updateArg.runsFailed).toBe(1);
  });

  it('counts partial outcome as failed', () => {
    const existing = {
      personaName: 'carol',
      role: 'developer',
      runsTotal: 3,
      runsSucceeded: 3,
      runsFailed: 0,
      avgQualityScore: 1.0,
      lastRunAt: '2026-05-01T00:00:00.000Z',
    };
    rows.push(existing);
    mockDb.where.mockReturnValueOnce({ all: vi.fn().mockReturnValue([existing]) });
    mockDb.set.mockReturnValueOnce({ where: vi.fn().mockReturnValue({ run: vi.fn() }) });

    accumulatePersonaStats({ personaName: 'carol', role: 'developer', outcome: 'partial' });

    const updateArg = mockDb.set.mock.calls[0][0] as { runsFailed: number };
    expect(updateArg.runsFailed).toBe(1);
  });

  it('uses provided qualityScore when supplied', () => {
    const existing = {
      personaName: 'alice',
      role: 'developer',
      runsTotal: 1,
      runsSucceeded: 1,
      runsFailed: 0,
      avgQualityScore: 1.0,
      lastRunAt: '2026-05-01T00:00:00.000Z',
    };
    rows.push(existing);
    mockDb.where.mockReturnValueOnce({ all: vi.fn().mockReturnValue([existing]) });
    mockDb.set.mockReturnValueOnce({ where: vi.fn().mockReturnValue({ run: vi.fn() }) });

    accumulatePersonaStats({
      personaName: 'alice',
      role: 'developer',
      outcome: 'success',
      qualityScore: 0.8,
    });

    const updateArg = mockDb.set.mock.calls[0][0] as { avgQualityScore: number };
    // new avg = (1.0 * 1 + 0.8) / 2 = 0.9
    expect(updateArg.avgQualityScore).toBeCloseTo(0.9);
  });

  it('estimates qualityScore as 1.0 for success when not supplied', () => {
    const existing = {
      personaName: 'alice',
      role: 'developer',
      runsTotal: 1,
      runsSucceeded: 1,
      runsFailed: 0,
      avgQualityScore: 0.8,
      lastRunAt: '2026-05-01T00:00:00.000Z',
    };
    rows.push(existing);
    mockDb.where.mockReturnValueOnce({ all: vi.fn().mockReturnValue([existing]) });
    mockDb.set.mockReturnValueOnce({ where: vi.fn().mockReturnValue({ run: vi.fn() }) });

    accumulatePersonaStats({ personaName: 'alice', role: 'developer', outcome: 'success' });

    const updateArg = mockDb.set.mock.calls[0][0] as { avgQualityScore: number };
    // new avg = (0.8 * 1 + 1.0) / 2 = 0.9
    expect(updateArg.avgQualityScore).toBeCloseTo(0.9);
  });

  it('estimates qualityScore as 0.0 for failure when not supplied', () => {
    const existing = {
      personaName: 'bob',
      role: 'qa',
      runsTotal: 1,
      runsSucceeded: 1,
      runsFailed: 0,
      avgQualityScore: 1.0,
      lastRunAt: '2026-05-01T00:00:00.000Z',
    };
    rows.push(existing);
    mockDb.where.mockReturnValueOnce({ all: vi.fn().mockReturnValue([existing]) });
    mockDb.set.mockReturnValueOnce({ where: vi.fn().mockReturnValue({ run: vi.fn() }) });

    accumulatePersonaStats({ personaName: 'bob', role: 'qa', outcome: 'failure' });

    const updateArg = mockDb.set.mock.calls[0][0] as { avgQualityScore: number };
    // new avg = (1.0 * 1 + 0.0) / 2 = 0.5
    expect(updateArg.avgQualityScore).toBeCloseTo(0.5);
  });

  it('sets new row avgQualityScore to the estimated/supplied score directly', () => {
    mockDb.where.mockReturnValueOnce({ all: vi.fn().mockReturnValue([]) });
    let inserted: Record<string, unknown> = {};
    mockDb.values.mockImplementationOnce((v: unknown) => {
      inserted = v as Record<string, unknown>;
      return { run: vi.fn() };
    });

    accumulatePersonaStats({
      personaName: 'new-persona',
      role: 'reviewer',
      outcome: 'success',
      qualityScore: 0.95,
    });

    expect(inserted.avgQualityScore).toBeCloseTo(0.95);
    expect(inserted.runsTotal).toBe(1);
    expect(inserted.runsSucceeded).toBe(1);
    expect(inserted.runsFailed).toBe(0);
  });
});
