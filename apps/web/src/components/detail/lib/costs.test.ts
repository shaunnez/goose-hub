/** @vitest-environment jsdom */
import { fetchIssueCosts } from '@/lib/api';
import type { CostRowDto, WorkItemCostsDto } from '@/lib/types';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useIssueCostsBreakdown } from './costs';

vi.mock('@/lib/api', () => ({
  fetchIssueCosts: vi.fn(),
}));

afterEach(() => {
  vi.mocked(fetchIssueCosts).mockReset();
});

function row(partial: Partial<CostRowDto>): CostRowDto {
  return {
    runId: 'r1',
    workItemId: 'wi-1',
    stage: 'qa',
    skill: 'qa-test',
    modelId: 'claude-sonnet-4-6',
    provider: 'claude',
    inputTokens: 100,
    outputTokens: 50,
    costUsd: 0.01,
    costLabel: 'exact',
    personaId: null,
    createdAt: new Date().toISOString(),
    ...partial,
  };
}

function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return createElement(QueryClientProvider, { client }, children);
}

describe('useIssueCostsBreakdown', () => {
  it('returns the empty default when id is empty (does not fetch)', () => {
    const { result } = renderHook(() => useIssueCostsBreakdown('proj', ''), { wrapper });
    expect(vi.mocked(fetchIssueCosts)).not.toHaveBeenCalled();
    expect(result.current.total).toBe(0);
    expect(result.current.runCount).toBe(0);
    expect(result.current.byRun.size).toBe(0);
    expect(result.current.byStage.size).toBe(0);
    expect(result.current.bySkill.size).toBe(0);
  });

  it('keys cost rows by runId and aggregates by stage', async () => {
    const data: WorkItemCostsDto = {
      workItemId: 'wi-1',
      totalUsd: 0.36,
      hasEstimated: false,
      rows: [
        row({ runId: 'r-qa-1', stage: 'qa', costUsd: 0.05, inputTokens: 200, outputTokens: 100 }),
        row({ runId: 'r-qa-2', stage: 'qa', costUsd: 0.06, inputTokens: 300, outputTokens: 100 }),
        row({ runId: 'r-dev-1', stage: 'dev', costUsd: 0.25, inputTokens: 800, outputTokens: 400 }),
      ],
    };
    vi.mocked(fetchIssueCosts).mockResolvedValueOnce(data);

    const { result } = renderHook(() => useIssueCostsBreakdown('proj', '42'), { wrapper });
    await waitFor(() => {
      expect(result.current.runCount).toBe(3);
    });

    expect(result.current.total).toBeCloseTo(0.36, 5);
    expect(result.current.totalTokens).toBe(200 + 100 + 300 + 100 + 800 + 400);
    expect(result.current.byRun.get('r-dev-1')?.costUsd).toBe(0.25);

    const qa = result.current.byStage.get('qa');
    expect(qa?.runCount).toBe(2);
    expect(qa?.usd).toBeCloseTo(0.11, 5);
    expect(qa?.tokens).toBe(700);

    const dev = result.current.byStage.get('dev');
    expect(dev?.runCount).toBe(1);
    expect(dev?.tokens).toBe(1200);
  });

  it("flips a stage's label to 'estimated' when any row in it is estimated", async () => {
    const data: WorkItemCostsDto = {
      workItemId: 'wi-1',
      totalUsd: 0.1,
      hasEstimated: true,
      rows: [
        row({ runId: 'r1', stage: 'review', costLabel: 'exact', costUsd: 0.04 }),
        row({ runId: 'r2', stage: 'review', costLabel: 'estimated', costUsd: 0.06 }),
      ],
    };
    vi.mocked(fetchIssueCosts).mockResolvedValueOnce(data);

    const { result } = renderHook(() => useIssueCostsBreakdown('proj', '42'), { wrapper });
    await waitFor(() => {
      expect(result.current.runCount).toBe(2);
    });

    expect(result.current.totalLabel).toBe('estimated');
    expect(result.current.byStage.get('review')?.label).toBe('estimated');
  });

  it('aggregates discover costs by skill while preserving byStage totals', async () => {
    const data: WorkItemCostsDto = {
      workItemId: 'wi-1',
      totalUsd: 0.17,
      hasEstimated: false,
      rows: [
        row({
          runId: 'r-grill-1',
          stage: 'discover',
          skill: 'grill-me',
          costUsd: 0.03,
          inputTokens: 120,
          outputTokens: 80,
        }),
        row({
          runId: 'r-grill-2',
          stage: 'discover',
          skill: 'grill-me',
          costUsd: 0.02,
          inputTokens: 90,
          outputTokens: 60,
        }),
        row({
          runId: 'r-prd-1',
          stage: 'discover',
          skill: 'write-prd',
          costUsd: 0.12,
          inputTokens: 400,
          outputTokens: 250,
        }),
      ],
    };
    vi.mocked(fetchIssueCosts).mockResolvedValueOnce(data);

    const { result } = renderHook(() => useIssueCostsBreakdown('proj', '42'), { wrapper });
    await waitFor(() => {
      expect(result.current.runCount).toBe(3);
    });

    const discover = result.current.byStage.get('discover');
    expect(discover?.runCount).toBe(3);
    expect(discover?.usd).toBeCloseTo(0.17, 5);
    expect(discover?.tokens).toBe(1000);

    const grill = result.current.bySkill.get('grill-me');
    expect(grill?.stage).toBe('discover');
    expect(grill?.runCount).toBe(2);
    expect(grill?.usd).toBeCloseTo(0.05, 5);
    expect(grill?.tokens).toBe(350);

    const prd = result.current.bySkill.get('write-prd');
    expect(prd?.stage).toBe('discover');
    expect(prd?.runCount).toBe(1);
    expect(prd?.usd).toBeCloseTo(0.12, 5);
    expect(prd?.tokens).toBe(650);
  });

  it("flips a skill label to 'estimated' when any row in it is estimated", async () => {
    const data: WorkItemCostsDto = {
      workItemId: 'wi-1',
      totalUsd: 0.2,
      hasEstimated: true,
      rows: [
        row({
          runId: 'r-grill-1',
          stage: 'discover',
          skill: 'grill-me',
          costUsd: 0.04,
          costLabel: 'exact',
        }),
        row({
          runId: 'r-grill-2',
          stage: 'discover',
          skill: 'grill-me',
          costUsd: 0.06,
          costLabel: 'estimated',
        }),
        row({
          runId: 'r-prd-1',
          stage: 'discover',
          skill: 'write-prd',
          costUsd: 0.1,
          costLabel: 'exact',
        }),
      ],
    };
    vi.mocked(fetchIssueCosts).mockResolvedValueOnce(data);

    const { result } = renderHook(() => useIssueCostsBreakdown('proj', '42'), { wrapper });
    await waitFor(() => {
      expect(result.current.runCount).toBe(3);
    });

    expect(result.current.byStage.get('discover')?.label).toBe('estimated');
    expect(result.current.bySkill.get('grill-me')?.label).toBe('estimated');
    expect(result.current.bySkill.get('write-prd')?.label).toBe('exact');
  });
});
