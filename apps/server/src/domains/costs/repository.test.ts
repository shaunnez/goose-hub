import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockListCostsForWorkItem, mockTotalsForProjectSince, mockTotalsByStageForProjectSince } =
  vi.hoisted(() => ({
    mockListCostsForWorkItem: vi.fn(),
    mockTotalsForProjectSince: vi.fn(),
    mockTotalsByStageForProjectSince: vi.fn(),
  }));

vi.mock('@goose-hub/core/cost/repository.js', () => ({
  listCostsForWorkItem: mockListCostsForWorkItem,
  totalsForProjectSince: mockTotalsForProjectSince,
  totalsByStageForProjectSince: mockTotalsByStageForProjectSince,
}));

import {
  listCostsForWorkItem,
  totalsByStageForProjectSince,
  totalsForProjectSince,
} from './repository.js';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('costs/repository wrapper', () => {
  it('delegates listCostsForWorkItem to the core function', () => {
    const rows = [{ runId: 'r1' }];
    mockListCostsForWorkItem.mockReturnValue(rows);

    const result = listCostsForWorkItem('github:org/repo#1');
    expect(result).toBe(rows);
    expect(mockListCostsForWorkItem).toHaveBeenCalledWith('github:org/repo#1');
  });

  it('delegates totalsForProjectSince to the core function', () => {
    const totals = { totalUsd: 1.5, totalRuns: 3, hasEstimated: false };
    mockTotalsForProjectSince.mockReturnValue(totals);

    const result = totalsForProjectSince('proj', '2026-01-01T00:00:00Z');
    expect(result).toBe(totals);
    expect(mockTotalsForProjectSince).toHaveBeenCalledWith('proj', '2026-01-01T00:00:00Z');
  });

  it('delegates totalsByStageForProjectSince to the core function', () => {
    const stages = [{ stage: 'qa', totalUsd: 0.5, totalRuns: 2, hasEstimated: false }];
    mockTotalsByStageForProjectSince.mockReturnValue(stages);

    const result = totalsByStageForProjectSince('proj', '2026-01-01T00:00:00Z');
    expect(result).toBe(stages);
    expect(mockTotalsByStageForProjectSince).toHaveBeenCalledWith('proj', '2026-01-01T00:00:00Z');
  });
});
