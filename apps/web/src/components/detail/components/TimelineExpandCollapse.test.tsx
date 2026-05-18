import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

afterEach(cleanup);

// ─── Minimal EventSource mock ─────────────────────────────────────────────────

class MockEventSource {
  static instances: MockEventSource[] = [];

  listeners = new Map<string, EventListener[]>();

  constructor() {
    MockEventSource.instances.push(this);
  }

  addEventListener = vi.fn((kind: string, listener: EventListener) => {
    const listeners = this.listeners.get(kind) ?? [];
    listeners.push(listener);
    this.listeners.set(kind, listeners);
  });
  removeEventListener = vi.fn((kind: string, listener: EventListener) => {
    const listeners = this.listeners.get(kind) ?? [];
    this.listeners.set(
      kind,
      listeners.filter((existing) => existing !== listener),
    );
  });
  close = vi.fn();
  onmessage: ((event: MessageEvent<string>) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;

  emit(event: AgentEventDto) {
    const message = new MessageEvent(event.kind, { data: JSON.stringify(event) });
    for (const listener of this.listeners.get(event.kind) ?? []) {
      listener(message);
    }
    this.onmessage?.(message);
  }
}

beforeEach(() => {
  MockEventSource.instances = [];
  vi.stubGlobal('EventSource', MockEventSource);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

vi.mock('@/lib/api', () => ({
  fetchEventsPage: vi.fn().mockResolvedValue({ events: [], hasMore: false }),
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

function renderTimeline(ui: React.ReactElement, queryClient = new QueryClient()) {
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

function makeRunEvent(
  id: number,
  runId: string,
  kind = 'agent.run-started',
  payload: AgentEventDto['payload'] = {},
): AgentEventDto {
  return {
    id,
    projectId: 'proj',
    workItemId: 'wi-1',
    kind,
    payload,
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
    const { fetchEventsPage } = await import('@/lib/api');
    vi.mocked(fetchEventsPage).mockResolvedValue({ events: [...RUN_GROUP_EVENTS], hasMore: false });

    const { TimelineSection } = await import('./TimelineSection');
    renderTimeline(<TimelineSection projectSlug="p" id="1" workItemId="w1" />);

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
    const { fetchEventsPage } = await import('@/lib/api');
    // Only plain events, no runId → no run-groups
    vi.mocked(fetchEventsPage).mockResolvedValue({
      events: [
        {
          id: 1,
          projectId: 'proj',
          workItemId: 'wi-1',
          kind: 'system.note',
          payload: { text: 'hello' },
          createdAt: new Date().toISOString(),
        },
      ],
      hasMore: false,
    });

    const { TimelineSection } = await import('./TimelineSection');
    renderTimeline(<TimelineSection projectSlug="p" id="1" workItemId="w1" />);

    // Wait for loading to complete (section container appears) then assert no expand button.
    await screen.findByTestId('timeline-section');
    await waitFor(() => {
      expect(screen.queryByTestId('timeline-expand-all')).toBeNull();
    });
  });

  it('shows model and runtime for a live run before cost rows exist', async () => {
    const { fetchEventsPage } = await import('@/lib/api');
    vi.mocked(fetchEventsPage).mockResolvedValue({
      events: [
        makeRunEvent(1, 'run-live', 'agent.run-started', {
          skill: 'implement',
          modelId: 'gpt-5.4-mini',
          runtime: 'codex-cli',
        }),
        makeRunEvent(2, 'run-live', 'agent.tool-call'),
      ],
      hasMore: false,
    });

    const { TimelineSection } = await import('./TimelineSection');
    renderTimeline(<TimelineSection projectSlug="p" id="1" workItemId="w1" />);

    expect(await screen.findByText('gpt-5.4-mini')).toBeTruthy();
    expect(screen.getByText('codex-cli')).toBeTruthy();
    expect(screen.getByText(/Started .* Running for/)).toBeTruthy();
  });

  it('invalidates issue costs when a run terminal event arrives over SSE', async () => {
    const { fetchEventsPage } = await import('@/lib/api');
    vi.mocked(fetchEventsPage).mockResolvedValue({
      events: [makeRunEvent(1, 'run-live', 'agent.run-started')],
      hasMore: false,
    });

    const queryClient = new QueryClient();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    const { TimelineSection } = await import('./TimelineSection');
    renderTimeline(<TimelineSection projectSlug="p" id="1" workItemId="w1" />, queryClient);

    await screen.findByTestId('timeline-section');
    await waitFor(() => expect(MockEventSource.instances.length).toBeGreaterThan(0));

    MockEventSource.instances[0].emit(makeRunEvent(2, 'run-live', 'agent.run-completed'));

    await waitFor(() => {
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['issue-costs', 'p', '1'] });
    });
  });
});
