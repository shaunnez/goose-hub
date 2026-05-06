/** @vitest-environment jsdom */
import type { WorkItemDto } from '@/lib/types';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TaskHeader } from './TaskHeader';

afterEach(cleanup);

vi.mock('@/lib/api', () => ({
  fetchMilestones: vi.fn().mockResolvedValue([]),
  setLabel: vi.fn(),
  setMilestone: vi.fn(),
  transitionState: vi.fn(),
  fetchPersonaNames: vi.fn().mockResolvedValue([]),
  fetchIssueCosts: vi
    .fn()
    .mockResolvedValue({ workItemId: 'wi', totalUsd: 0, hasEstimated: false, rows: [] }),
}));

const ITEM: WorkItemDto = {
  id: 'wi-1',
  externalId: '42',
  repoRef: 'owner/repo',
  title: 'My Issue',
  body: '',
  type: 'feature',
  priority: 'medium',
  mode: 'auto',
  state: 'factory:in-progress',
  authorIsOwner: true,
  schedule: 'current',
  exec: 'auto',
  dependsOn: [],
  blocks: [],
  createdAt: new Date().toISOString(),
  lastPersonaId: 'goose-dev-v1',
};

function render_(item?: WorkItemDto) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  // Pre-seed persona names so usePersonaMap resolves synchronously.
  qc.setQueryData(
    ['persona-names'],
    [{ personaId: 'goose-dev-v1', codename: 'Cedar', role: 'developer' }],
  );
  render(
    <QueryClientProvider client={qc}>
      <TaskHeader item={item} projectSlug="proj" />
    </QueryClientProvider>,
  );
}

describe('TaskHeader (#518)', () => {
  it('renders the lane key in the subtitle line below the title', () => {
    render_(ITEM);
    // factory:in-progress maps to lane key "dev"
    const header = screen.getByTestId('task-header');
    expect(header.textContent).toContain('dev');
  });

  it('renders the persona label (codename + role abbrev) in the subtitle', () => {
    render_(ITEM);
    const header = screen.getByTestId('task-header');
    expect(header.textContent).toContain('Cedar (DEV)');
  });

  it('renders "—" placeholders when item is undefined', () => {
    render_(undefined);
    const header = screen.getByTestId('task-header');
    expect(header.textContent).toContain('— · —');
  });

  it('renders the issue title in the h1', () => {
    render_(ITEM);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('My Issue');
  });
});
