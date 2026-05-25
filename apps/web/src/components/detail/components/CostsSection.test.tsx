/** @vitest-environment jsdom */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CostsSection } from './CostsSection';

vi.mock('@/lib/api', () => ({
  fetchIssueCosts: vi.fn().mockResolvedValue({
    workItemId: 'github:owner/repo#42',
    totalUsd: 0.25,
    hasEstimated: false,
    rows: [
      {
        runId: 'run-1',
        workItemId: 'github:owner/repo#42',
        stage: 'dev',
        skill: 'implement',
        modelId: 'gpt-5.4',
        provider: 'codex',
        inputTokens: 1000,
        cachedInputTokens: 300,
        outputTokens: 500,
        reasoningOutputTokens: 120,
        costUsd: 0.25,
        costLabel: 'exact',
        cacheHitRatio: 0.3,
        personaId: null,
        createdAt: '2026-05-23T00:00:00Z',
        readCount: 7,
        grepCount: 2,
        writeCount: 1,
        editCount: 1,
        bytesRead: 8192,
        uniquePathsRead: 5,
        redundantReads: 2,
      },
    ],
  }),
  fetchProjectConfigs: vi.fn().mockResolvedValue([]),
}));

vi.mock('@/lib/usePersonaMap', () => ({
  getPersonaInitials: () => null,
  getPersonaLabel: () => null,
  usePersonaMap: () => new Map(),
}));

afterEach(() => cleanup());

describe('CostsSection', () => {
  it('renders raw-run reads and bytes with redundant-read warning text', async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    render(
      <QueryClientProvider client={client}>
        <CostsSection projectSlug="goose-hub-self" id="42" />
      </QueryClientProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('costs-row-run-1')).toBeTruthy());

    expect(screen.getByText('Reads')).toBeTruthy();
    expect(screen.getByText('Bytes')).toBeTruthy();
    expect(screen.getByText('Cache hit')).toBeTruthy();
    expect(screen.getAllByText('cache 30%').length).toBeGreaterThan(0);
    expect(screen.getByText('r 120')).toBeTruthy();
    expect(screen.getByText('7')).toBeTruthy();
    expect(screen.getByText('8.0 KB')).toBeTruthy();
    expect(screen.getByTitle('this run re-read 2 files it had already loaded.')).toBeTruthy();
  });
});
