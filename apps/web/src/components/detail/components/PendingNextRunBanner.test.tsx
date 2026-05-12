/** @vitest-environment jsdom */
import type { AgentEventDto } from '@/lib/types';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { computeIsLive } from '../lib/timeline';
import { PendingNextRunBanner } from './PendingNextRunBanner';

// ─── mock api ────────────────────────────────────────────────────────────────
vi.mock('@/lib/api', () => ({
  fetchEvents: vi.fn(),
  resumeIssue: vi.fn().mockResolvedValue(undefined),
}));

import { fetchEvents, resumeIssue } from '@/lib/api';

afterEach(cleanup);

function makeEvent(kind: string, id: number, payload: Record<string, unknown> = {}): AgentEventDto {
  return {
    id,
    projectId: 'proj',
    workItemId: 'item',
    kind,
    payload,
    runId: 'run-1',
    personaId: null,
    createdAt: new Date(id * 1000).toISOString(),
  };
}

function wrapper(children: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

// ─── computeIsLive (moved to timeline.ts) ────────────────────────────────────
describe('computeIsLive', () => {
  it('returns false when no events', () => {
    expect(computeIsLive([])).toBe(false);
  });

  it('returns false when no agent.run-started event', () => {
    expect(computeIsLive([makeEvent('state.transitioned', 1)])).toBe(false);
  });

  it('returns true when run-started with no terminal event after', () => {
    const events = [makeEvent('agent.run-started', 1), makeEvent('agent.spawned', 2)];
    expect(computeIsLive(events)).toBe(true);
  });

  it('returns false when run-started followed by agent.run-completed', () => {
    const events = [makeEvent('agent.run-started', 1), makeEvent('agent.run-completed', 2)];
    expect(computeIsLive(events)).toBe(false);
  });

  it('returns false when run-started followed by prd.drafted', () => {
    const events = [makeEvent('agent.run-started', 1), makeEvent('prd.drafted', 2)];
    expect(computeIsLive(events)).toBe(false);
  });

  it('returns true when second run started after first completed', () => {
    const events = [
      makeEvent('agent.run-started', 1),
      makeEvent('agent.run-completed', 2),
      makeEvent('agent.run-started', 3),
    ];
    expect(computeIsLive(events)).toBe(true);
  });

  it('handles descending order (as returned by server API)', () => {
    const events = [
      makeEvent('agent.run-completed', 3),
      makeEvent('agent.run-started', 2),
      makeEvent('state.transitioned', 1),
    ];
    expect(computeIsLive(events)).toBe(false);
  });
});

// ─── PendingNextRunBanner stuck alert ────────────────────────────────────────
describe('PendingNextRunBanner stuck detection', () => {
  beforeEach(() => {
    vi.mocked(fetchEvents).mockReset();
  });

  it('shows amber alert with Retry when write-prd completed but no prd.drafted', async () => {
    vi.mocked(fetchEvents).mockResolvedValue([
      makeEvent('agent.run-started', 1, { skill: 'write-prd' }),
      makeEvent('agent.run-completed', 2, { skill: 'write-prd' }),
    ]);
    render(
      wrapper(
        <PendingNextRunBanner state="factory:prd-drafting" projectSlug="my-project" id="42" />,
      ),
    );
    const retryBtn = await screen.findByRole('button', { name: /retry/i });
    expect(retryBtn).toBeTruthy();
  });

  it('shows normal info banner (no button) when prd.drafted is present', async () => {
    vi.mocked(fetchEvents).mockResolvedValue([
      makeEvent('agent.run-started', 1, { skill: 'write-prd' }),
      makeEvent('agent.run-completed', 2, { skill: 'write-prd' }),
      makeEvent('prd.drafted', 3),
    ]);
    render(
      wrapper(
        <PendingNextRunBanner state="factory:prd-drafting" projectSlug="my-project" id="42" />,
      ),
    );
    await screen.findByText(/next run pending/i);
    expect(screen.queryByRole('button', { name: /retry/i })).toBeNull();
  });

  it('calls resumeIssue when Retry clicked', async () => {
    vi.mocked(fetchEvents).mockResolvedValue([
      makeEvent('agent.run-started', 1, { skill: 'write-prd' }),
      makeEvent('agent.run-completed', 2, { skill: 'write-prd' }),
    ]);
    render(
      wrapper(
        <PendingNextRunBanner state="factory:prd-drafting" projectSlug="my-project" id="42" />,
      ),
    );
    const btn = await screen.findByRole('button', { name: /retry/i });
    await userEvent.click(btn);
    expect(resumeIssue).toHaveBeenCalledWith('my-project', '42');
  });
});
