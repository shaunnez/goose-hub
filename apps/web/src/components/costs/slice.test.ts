/** @vitest-environment jsdom */
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(cleanup);

// ---- CostLegend ----

describe('CostLegend', () => {
  it('renders without crashing', async () => {
    const { CostLegend } = await import('./CostLegend');
    const { container } = render(CostLegend({}));
    expect(container).toBeTruthy();
  });
});

// ---- StageBar ----

describe('StageBar', () => {
  it('renders without crashing with required props', async () => {
    const { StageBar } = await import('./StageBar');
    const { container } = render(
      StageBar({
        stage: 'dev',
        totalUsd: 0.05,
        hasEstimated: false,
        totalRuns: 3,
        maxUsd: 0.1,
        cacheHitRatio: 0.4,
        cacheCreationInputTokens: 1000,
        reasoningOutputTokens: 200,
      }),
    );
    expect(container).toBeTruthy();
  });

  it('handles zero maxUsd without dividing by zero', async () => {
    const { StageBar } = await import('./StageBar');
    const { container } = render(
      StageBar({
        stage: 'qa',
        totalUsd: 0,
        hasEstimated: false,
        totalRuns: 0,
        maxUsd: 0,
        cacheHitRatio: 0,
        cacheCreationInputTokens: 0,
        reasoningOutputTokens: 0,
      }),
    );
    expect(container).toBeTruthy();
  });
});

// ---- CostsPage ----

vi.mock('react-router-dom', () => ({
  useParams: () => ({ slug: 'test-project' }),
}));

vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: undefined, isLoading: true }),
}));

vi.mock('@/lib/api', () => ({
  fetchCostSummary: vi.fn().mockResolvedValue(null),
}));

describe('CostsPage', () => {
  it('renders without crashing', async () => {
    const { CostsPage } = await import('./CostsPage');
    const { container } = render(CostsPage({}));
    expect(container).toBeTruthy();
  });
});
