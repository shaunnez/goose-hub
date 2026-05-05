/** @vitest-environment jsdom */
import { fetchEvents, fetchIssueCosts } from '@/lib/api';
import type { AgentEventDto, WorkItemCostsDto } from '@/lib/types';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TimelineSection } from './TimelineSection';

afterEach(cleanup);

vi.mock('@/lib/api', () => ({
  fetchEvents: vi.fn(),
  fetchIssueCosts: vi.fn(),
}));

vi.mock('@/lib/usePersonaMap', () => ({
  usePersonaMap: () => new Map(),
  getPersonaLabel: () => null,
}));

const mockEs = {
  addEventListener: vi.fn(),
  onmessage: null as ((e: MessageEvent) => void) | null,
  onerror: null as ((e: Event) => void) | null,
  close: vi.fn(),
};

beforeEach(() => {
  vi.mocked(fetchIssueCosts).mockResolvedValue({
    workItemId: 'wi-1',
    totalUsd: 0,
    hasEstimated: false,
    rows: [],
  } as WorkItemCostsDto);
  mockEs.addEventListener.mockReset();
  mockEs.close.mockReset();
  vi.stubGlobal(
    'EventSource',
    vi.fn(() => mockEs),
  );
});

function render_(jsx: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{jsx}</QueryClientProvider>);
}

function makeRunEvents(runId: string): AgentEventDto[] {
  const now = Date.now();
  return [
    {
      id: 1,
      projectId: 'proj',
      workItemId: 'wi-1',
      kind: 'agent.run-started',
      payload: { skill: 'implement' },
      runId,
      createdAt: new Date(now).toISOString(),
    } as AgentEventDto,
    {
      id: 2,
      projectId: 'proj',
      workItemId: 'wi-1',
      kind: 'agent.run-completed',
      payload: { skill: 'implement' },
      runId,
      createdAt: new Date(now + 1000).toISOString(),
    } as AgentEventDto,
  ];
}

describe('TimelineSection — expand / collapse all', () => {
  it('renders expand all and collapse all buttons when events exist', async () => {
    vi.mocked(fetchEvents).mockResolvedValueOnce(makeRunEvents('run-a'));
    render_(<TimelineSection projectSlug="proj" id="42" workItemId="wi-1" />);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /expand all/i })).toBeTruthy();
      expect(screen.getByRole('button', { name: /collapse all/i })).toBeTruthy();
    });
  });

  it('does not render expand / collapse buttons when timeline is empty', async () => {
    vi.mocked(fetchEvents).mockResolvedValueOnce([]);
    render_(<TimelineSection projectSlug="proj" id="42" workItemId="wi-1" />);
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /expand all/i })).toBeNull();
    });
  });

  it('collapse all closes run-group details elements', async () => {
    vi.mocked(fetchEvents).mockResolvedValueOnce(makeRunEvents('run-a'));
    render_(<TimelineSection projectSlug="proj" id="42" workItemId="wi-1" />);
    await waitFor(() => screen.getByRole('button', { name: /collapse all/i }));

    await userEvent.click(screen.getByRole('button', { name: /collapse all/i }));

    const details = document.querySelector('[data-run-id="run-a"] details') as HTMLDetailsElement;
    expect(details.open).toBe(false);
  });

  it('expand all re-opens previously collapsed run-group details', async () => {
    vi.mocked(fetchEvents).mockResolvedValueOnce(makeRunEvents('run-a'));
    render_(<TimelineSection projectSlug="proj" id="42" workItemId="wi-1" />);
    await waitFor(() => screen.getByRole('button', { name: /collapse all/i }));

    await userEvent.click(screen.getByRole('button', { name: /collapse all/i }));
    await userEvent.click(screen.getByRole('button', { name: /expand all/i }));

    const details = document.querySelector('[data-run-id="run-a"] details') as HTMLDetailsElement;
    expect(details.open).toBe(true);
  });
});
