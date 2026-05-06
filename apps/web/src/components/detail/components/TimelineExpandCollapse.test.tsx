/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

afterEach(cleanup);

// ─── Minimal EventSource mock ─────────────────────────────────────────────────

class MockEventSource {
  addEventListener = vi.fn();
  removeEventListener = vi.fn();
  close = vi.fn();
  onmessage = null;
  onerror = null;
}

beforeEach(() => {
  vi.stubGlobal('EventSource', MockEventSource);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

vi.mock('@/lib/api', () => ({
  fetchEvents: vi.fn().mockResolvedValue([]),
}));

vi.mock('../lib/costs', () => ({
  useIssueCostsBreakdown: () => ({ byRun: new Map() }),
}));

vi.mock('@/lib/usePersonaMap', () => ({
  usePersonaMap: () => new Map(),
  getPersonaLabel: () => null,
}));

// ─── Test data: two run-groups ────────────────────────────────────────────────

import type { AgentEventDto } from '@/lib/types';

function makeRunEvent(id: number, runId: string, kind = 'agent.run-started'): AgentEventDto {
  return {
    id,
    projectId: 'proj',
    workItemId: 'wi-1',
    kind,
    payload: {},
    runId,
    createdAt: new Date(Date.now() + id * 1000).toISOString(),
  };
}

const RUN_GROUP_EVENTS: AgentEventDto[] = [
  makeRunEvent(1, 'run-a', 'agent.run-started'),
  makeRunEvent(2, 'run-a', 'agent.run-completed'),
  makeRunEvent(3, 'run-b', 'agent.run-started'),
  makeRunEvent(4, 'run-b', 'agent.run-completed'),
];

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('TimelineSection — expand/collapse all', () => {
  async function renderWithRunGroups() {
    const { fetchEvents } = await import('@/lib/api');
    vi.mocked(fetchEvents).mockResolvedValue([...RUN_GROUP_EVENTS]);

    const { TimelineSection } = await import('./TimelineSection');
    render(<TimelineSection projectSlug="p" id="1" workItemId="w1" />);

    // Wait for events to load and run-groups to appear
    await screen.findByTestId('timeline-expand-all');
    return screen;
  }

  it('renders expand all button when run-groups exist', async () => {
    await renderWithRunGroups();
    expect(screen.getByTestId('timeline-expand-all')).toBeTruthy();
  });

  it('renders collapse all button when run-groups exist', async () => {
    await renderWithRunGroups();
    expect(screen.getByTestId('timeline-collapse-all')).toBeTruthy();
  });

  it('collapse all sets all run-group details to closed', async () => {
    await renderWithRunGroups();
    fireEvent.click(screen.getByTestId('timeline-collapse-all'));
    await waitFor(() => {
      const details = document.querySelectorAll('[data-run-id] details');
      expect(details.length).toBeGreaterThan(0);
      for (const d of details) {
        expect((d as HTMLDetailsElement).open).toBe(false);
      }
    });
  });

  it('expand all after collapse restores all run-group details to open', async () => {
    await renderWithRunGroups();
    fireEvent.click(screen.getByTestId('timeline-collapse-all'));
    fireEvent.click(screen.getByTestId('timeline-expand-all'));
    await waitFor(() => {
      const details = document.querySelectorAll('[data-run-id] details');
      expect(details.length).toBeGreaterThan(0);
      for (const d of details) {
        expect((d as HTMLDetailsElement).open).toBe(true);
      }
    });
  });

  it('does not render control bar when there are no run-groups', async () => {
    const { fetchEvents } = await import('@/lib/api');
    // Only plain events, no runId → no run-groups
    vi.mocked(fetchEvents).mockResolvedValue([
      {
        id: 1,
        projectId: 'proj',
        workItemId: 'wi-1',
        kind: 'system.note',
        payload: { text: 'hello' },
        createdAt: new Date().toISOString(),
      },
    ]);

    const { TimelineSection } = await import('./TimelineSection');
    render(<TimelineSection projectSlug="p" id="1" workItemId="w1" />);

    // Give time for fetch to resolve
    await waitFor(() => {
      expect(screen.queryByTestId('timeline-expand-all')).toBeNull();
    });
  });
});
