/** @vitest-environment jsdom */
import { fetchTriageResult, setRepoOverride } from '@/lib/api';
import type { TriageResultDto } from '@/lib/types';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TriageResultsSection } from './TriageResultsSection';

afterEach(cleanup);

vi.mock('@/lib/api', () => ({
  fetchTriageResult: vi.fn(),
  setRepoOverride: vi.fn(),
}));

const TRIAGE_DATA: TriageResultDto = {
  priority: 'high',
  type: 'bug',
  candidates: [
    {
      repo: 'shaunnez/goose-hub',
      confidence: 85,
      tier: 1,
      evidence: 'Keyword match in src/lib/',
    },
  ],
  overrideRepo: null,
  repositories: ['shaunnez/goose-hub', 'shaunnez/target-projects'],
};

function renderSection(slug = 'proj', id = '42') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <TriageResultsSection projectSlug={slug} id={id} />
    </QueryClientProvider>,
  );
  return qc;
}

describe('TriageResultsSection — empty state', () => {
  it('renders empty state when fetch returns null', async () => {
    vi.mocked(fetchTriageResult).mockResolvedValueOnce(null);
    renderSection();
    const el = await screen.findByTestId('triage-empty-state');
    expect(el).toBeTruthy();
  });

  it('shows "No triage result yet" heading in empty state', async () => {
    vi.mocked(fetchTriageResult).mockResolvedValueOnce(null);
    renderSection();
    await screen.findByTestId('triage-empty-state');
    expect(screen.getByText('No triage result yet')).toBeTruthy();
  });

  it('shows section header in empty state', async () => {
    vi.mocked(fetchTriageResult).mockResolvedValueOnce(null);
    renderSection();
    await screen.findByTestId('triage-empty-state');
    expect(screen.getByText('Repo candidates & classification')).toBeTruthy();
  });

  it('shows descriptive sub-copy in empty state', async () => {
    vi.mocked(fetchTriageResult).mockResolvedValueOnce(null);
    renderSection();
    await screen.findByTestId('triage-empty-state');
    expect(screen.getByTestId('triage-empty-description')).toBeTruthy();
  });
});

describe('TriageResultsSection — with data', () => {
  it('renders triage section when data is present', async () => {
    vi.mocked(fetchTriageResult).mockResolvedValueOnce(TRIAGE_DATA);
    renderSection();
    const el = await screen.findByTestId('triage-results-section');
    expect(el).toBeTruthy();
  });

  it('does not render empty state when data is present', async () => {
    vi.mocked(fetchTriageResult).mockResolvedValueOnce(TRIAGE_DATA);
    renderSection();
    await screen.findByTestId('triage-results-section');
    expect(screen.queryByTestId('triage-empty-state')).toBeNull();
  });
});
