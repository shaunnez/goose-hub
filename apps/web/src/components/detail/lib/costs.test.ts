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
    cachedInputTokens: 0,
    outputTokens: 50,
    reasoningOutputTokens: 0,
    costUsd: 0.01,
    costLabel: 'exact',
    cacheHitRatio: 0,
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
        row({
          runId: 'r-qa-1',
          stage: 'qa',
          costUsd: 0.05,
          inputTokens: 200,
          cachedInputTokens: 50,
          outputTokens: 100,
          reasoningOutputTokens: 12,
          cacheHitRatio: 0.25,
        }),
        row({
          runId: 'r-qa-2',
          stage: 'qa',
          costUsd: 0.06,
          inputTokens: 300,
          cachedInputTokens: 150,
          outputTokens: 100,
          reasoningOutputTokens: 8,
          cacheHitRatio: 0.5,
        }),
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
    expect(qa?.cachedInputTokens).toBe(200);
    expect(qa?.reasoningOutputTokens).toBe(20);
    expect(qa?.cacheHitRatio).toBeCloseTo(0.4, 5);

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

  it('aggregates costs by skill without changing stage totals', async () => {
    const data: WorkItemCostsDto = {
      workItemId: 'wi-1',
      totalUsd: 0.22,
      hasEstimated: true,
      rows: [
        row({
          runId: 'discover-grill-1',
          stage: 'discover',
          skill: 'grill-me',
          costUsd: 0.05,
          inputTokens: 100,
          cachedInputTokens: 20,
          outputTokens: 40,
          reasoningOutputTokens: 10,
          cacheHitRatio: 0.2,
          costLabel: 'exact',
        }),
        row({
          runId: 'discover-grill-2',
          stage: 'discover',
          skill: 'grill-me',
          costUsd: 0.04,
          inputTokens: 80,
          cachedInputTokens: 40,
          outputTokens: 20,
          reasoningOutputTokens: 5,
          cacheHitRatio: 0.5,
          costLabel: 'estimated',
        }),
        row({
          runId: 'discover-prd-1',
          stage: 'discover',
          skill: 'write-prd',
          costUsd: 0.13,
          inputTokens: 300,
          cachedInputTokens: 60,
          outputTokens: 120,
          reasoningOutputTokens: 30,
          cacheHitRatio: 0.2,
          costLabel: 'exact',
        }),
      ],
    };
    vi.mocked(fetchIssueCosts).mockResolvedValueOnce(data);

    const { result } = renderHook(() => useIssueCostsBreakdown('proj', '42'), { wrapper });
    await waitFor(() => {
      expect(result.current.runCount).toBe(3);
    });

    const grill = result.current.bySkill.get('grill-me');
    expect(grill?.runCount).toBe(2);
    expect(grill?.usd).toBeCloseTo(0.09, 5);
    expect(grill?.tokens).toBe(240);
    expect(grill?.cachedInputTokens).toBe(60);
    expect(grill?.reasoningOutputTokens).toBe(15);
    expect(grill?.cacheHitRatio).toBeCloseTo(60 / 180, 5);
    expect(grill?.label).toBe('estimated');

    const prd = result.current.bySkill.get('write-prd');
    expect(prd?.runCount).toBe(1);
    expect(prd?.usd).toBeCloseTo(0.13, 5);
    expect(prd?.tokens).toBe(420);
    expect(prd?.label).toBe('exact');

    const discover = result.current.byStage.get('discover');
    expect(discover?.usd).toBeCloseTo(0.22, 5);
    expect(discover?.tokens).toBe(660);
    expect(discover?.runCount).toBe(3);
    expect(discover?.label).toBe('estimated');
  });
});
