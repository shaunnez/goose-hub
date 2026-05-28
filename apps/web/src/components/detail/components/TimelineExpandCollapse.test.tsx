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

  emitNamed(event: AgentEventDto) {
    const message = new MessageEvent(event.kind, { data: JSON.stringify(event) });
    for (const listener of this.listeners.get(event.kind) ?? []) {
      listener(message);
    }
  }

  emitMessage(event: AgentEventDto) {
    const message = new MessageEvent('message', { data: JSON.stringify(event) });
    this.onmessage?.(message);
  }
}

beforeEach(() => {
  MockEventSource.instances = [];
  vi.clearAllMocks();
  mockCostsBreakdown.byRun.clear();
  vi.stubGlobal('EventSource', MockEventSource);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

vi.mock('@/lib/api', () => ({
  fetchEvents: vi.fn().mockResolvedValue([]),
  fetchEventsPage: vi.fn().mockResolvedValue({ events: [], hasMore: false }),
  fetchIntervention: vi.fn(),
  fetchIssueInterventions: vi.fn().mockResolvedValue([]),
}));

const mockCostsBreakdown = vi.hoisted(() => ({ byRun: new Map<string, CostRowDto>() }));

vi.mock('../lib/costs', () => ({
  useIssueCostsBreakdown: () => ({ byRun: mockCostsBreakdown.byRun }),
}));

vi.mock('@/lib/usePersonaMap', () => ({
  usePersonaMap: () => new Map(),
  getPersonaLabel: () => null,
}));

// ─── Test data: two run-groups ────────────────────────────────────────────────

import type { AgentEventDto, CostRowDto, InterventionDto, InterventionEventDto } from '@/lib/types';

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

function makeCostRow(runId: string, overrides: Partial<CostRowDto> = {}): CostRowDto {
  return {
    runId,
    workItemId: 'wi-1',
    stage: 'investigate',
    skill: 'scout-schema',
    modelId: 'model-a',
    provider: 'codex',
    inputTokens: 100,
    cachedInputTokens: 0,
    outputTokens: 50,
    reasoningOutputTokens: 0,
    costUsd: 0.01,
    costLabel: 'exact',
    cacheHitRatio: 0,
    personaId: null,
    createdAt: new Date(0).toISOString(),
    ...overrides,
  };
}

function makePlainEvent(id: number, createdAt: string): AgentEventDto {
  return {
    id,
    projectId: 'proj',
    workItemId: 'wi-1',
    kind: 'system.note',
    payload: { text: `note ${id}` },
    createdAt,
  };
}

function makeEvent(
  id: number,
  kind: string,
  payload: AgentEventDto['payload'] = {},
): AgentEventDto {
  return {
    id,
    projectId: 'proj',
    workItemId: 'wi-1',
    kind,
    payload,
    createdAt: new Date(Date.now() + id * 1000).toISOString(),
  };
}

function makeCodexTransportWarning(id: number, runId: string): AgentEventDto {
  return makeRunEvent(id, runId, 'agent.log', {
    stream: 'stderr',
    text: JSON.stringify({
      source: 'responses_websocket',
      message: 'failed to connect to websocket: 503 Service Unavailable',
    }),
  });
}

function invalidatedQueryKey(calls: readonly (readonly unknown[])[], queryKey: readonly unknown[]) {
  return calls.some(([input]) => {
    const candidate = input as { queryKey?: unknown };
    return JSON.stringify(candidate.queryKey) === JSON.stringify(queryKey);
  });
}

function makeIntervention(overrides: Partial<InterventionDto> = {}): InterventionDto {
  return {
    id: 'intervention-123456789',
    projectId: 'p',
    workItemId: 'w1',
    interventionType: 'manual_override',
    status: 'RESOLVED',
    title: 'Manual operator transition',
    reason: 'Operator requested factory:needs-human -> factory:triaging',
    rootCauseSignature: 'manual:w1',
    correlationId: 'corr-1',
    sourceEventId: null,
    proposedOptions: [],
    decidedActionType: 'manual_transition',
    decidedActionPayload: null,
    decidedBy: 'ui',
    decisionReason: 'manual operator transition',
    applicationResult: null,
    verification: null,
    leaseOwner: null,
    leaseExpiresAt: null,
    version: 1,
    createdAt: '2026-05-04T10:00:00Z',
    updatedAt: '2026-05-04T10:03:00Z',
    resolvedAt: '2026-05-04T10:03:00Z',
    ...overrides,
  };
}

function makeInterventionEvent(
  id: number,
  eventType: string,
  createdAt: string,
  overrides: Partial<InterventionEventDto> = {},
): InterventionEventDto {
  return {
    id,
    interventionId: 'intervention-123456789',
    projectId: 'p',
    workItemId: 'w1',
    eventType,
    actor: 'ui',
    fromStatus: null,
    toStatus: null,
    payload: {},
    correlationId: 'corr-1',
    createdAt,
    ...overrides,
  };
}

function makeInterventionDetail(intervention = makeIntervention()) {
  return {
    intervention,
    events: [
      makeInterventionEvent(1, 'open', '2026-05-04T10:02:00Z', { toStatus: 'OPEN' }),
      makeInterventionEvent(2, 'resolve', '2026-05-04T10:03:00Z', {
        fromStatus: 'VERIFIED',
        toStatus: 'RESOLVED',
      }),
    ],
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

  it('renders control bar for canonical section accordions even when there are no run-groups', async () => {
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

    await screen.findByTestId('timeline-section');
    expect(await screen.findByTestId('timeline-expand-all')).toBeTruthy();
    expect(screen.getByTestId('timeline-collapse-all')).toBeTruthy();
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

  it('renders recovered Codex websocket 503 stderr as a warning without changing completed status', async () => {
    const { fetchEventsPage } = await import('@/lib/api');
    const rawWarning = JSON.stringify({
      source: 'responses_websocket',
      message: 'failed to connect to websocket: 503 Service Unavailable',
    });
    vi.mocked(fetchEventsPage).mockResolvedValue({
      events: [
        makeRunEvent(1, 'run-codex', 'agent.run-started', { skill: 'implement' }),
        makeCodexTransportWarning(2, 'run-codex'),
        makeRunEvent(3, 'run-codex', 'agent.run-completed', { skill: 'implement' }),
      ],
      hasMore: false,
    });

    const { TimelineSection } = await import('./TimelineSection');
    renderTimeline(<TimelineSection projectSlug="p" id="1" workItemId="w1" />);

    await screen.findByTestId('timeline-expand-all');
    fireEvent.click(screen.getByTestId('timeline-expand-all'));

    expect((await screen.findAllByText('Complete')).length).toBeGreaterThan(0);
    expect(
      await screen.findByText('Codex transport warning: websocket 503; run recovered'),
    ).toBeTruthy();
    expect(screen.queryByText(rawWarning)).toBeNull();
  });

  it('uses swarm scout events, not lifecycle completion, for scout row status badges', async () => {
    const { fetchEventsPage } = await import('@/lib/api');
    vi.mocked(fetchEventsPage).mockResolvedValue({
      events: [
        makeRunEvent(1, 'run-investigate:scout:scout-schema:0', 'agent.run-started', {
          skill: 'scout-schema',
        }),
        makeRunEvent(2, 'run-investigate:scout:scout-schema:0', 'swarm.scout-skipped', {
          scoutName: 'scout-schema',
          skippedReason: 'No schema boundary applies',
        }),
        makeRunEvent(3, 'run-investigate:scout:scout-schema:0', 'agent.run-completed', {
          skill: 'scout-schema',
        }),
        makeRunEvent(4, 'run-investigate:scout:scout-code-path:1', 'agent.run-started', {
          skill: 'scout-code-path',
        }),
        makeRunEvent(5, 'run-investigate:scout:scout-code-path:1', 'swarm.scout-failed', {
          scoutName: 'scout-code-path',
          errorReason: 'no evidence',
        }),
        makeRunEvent(6, 'run-investigate:scout:scout-code-path:1', 'agent.run-completed', {
          skill: 'scout-code-path',
        }),
      ],
      hasMore: false,
    });

    const { TimelineSection } = await import('./TimelineSection');
    renderTimeline(<TimelineSection projectSlug="p" id="1" workItemId="w1" />);

    expect(await screen.findByText('Skipped')).toBeTruthy();
    expect(await screen.findByText('Failed')).toBeTruthy();
  });

  it('aggregates base and evidence-retry costs in the collapsed scout row', async () => {
    const { fetchEventsPage } = await import('@/lib/api');
    const baseRunId = 'run-investigate:scout:scout-schema:0';
    const retryRunId = `${baseRunId}:evidence-retry`;
    mockCostsBreakdown.byRun.set(
      baseRunId,
      makeCostRow(baseRunId, { inputTokens: 100, outputTokens: 50, costUsd: 0.01 }),
    );
    mockCostsBreakdown.byRun.set(
      retryRunId,
      makeCostRow(retryRunId, { inputTokens: 40, outputTokens: 10, costUsd: 0.02 }),
    );
    vi.mocked(fetchEventsPage).mockResolvedValue({
      events: [
        makeRunEvent(1, baseRunId, 'agent.run-started', { skill: 'scout-schema' }),
        makeRunEvent(2, baseRunId, 'agent.run-completed', { skill: 'scout-schema' }),
        makeRunEvent(3, retryRunId, 'agent.run-started', { skill: 'scout-schema' }),
        makeRunEvent(4, retryRunId, 'swarm.scout-completed', {
          scoutName: 'scout-schema',
          findingsCount: 0,
        }),
        makeRunEvent(5, retryRunId, 'agent.run-completed', { skill: 'scout-schema' }),
      ],
      hasMore: false,
    });

    const { TimelineSection } = await import('./TimelineSection');
    renderTimeline(<TimelineSection projectSlug="p" id="1" workItemId="w1" />);

    const badges = await screen.findAllByTestId('cost-badge');
    expect(
      badges.some(
        (badge) => badge.textContent?.includes('200') && badge.textContent.includes('$0.03'),
      ),
    ).toBe(true);
  });

  it('renders non-lifecycle terminal runs with transport warnings as recovered', async () => {
    const { fetchEventsPage } = await import('@/lib/api');
    vi.mocked(fetchEventsPage).mockResolvedValue({
      events: [
        makeRunEvent(1, 'run-prd', 'agent.run-started', { skill: 'write-prd' }),
        makeCodexTransportWarning(2, 'run-prd'),
        makeRunEvent(3, 'run-prd', 'prd.approved', { skill: 'write-prd' }),
      ],
      hasMore: false,
    });

    const { TimelineSection } = await import('./TimelineSection');
    renderTimeline(<TimelineSection projectSlug="p" id="1" workItemId="w1" />);

    await screen.findByTestId('timeline-expand-all');
    fireEvent.click(screen.getByTestId('timeline-expand-all'));

    expect((await screen.findAllByText('Complete')).length).toBeGreaterThan(0);
    expect(
      await screen.findByText('Codex transport warning: websocket 503; run recovered'),
    ).toBeTruthy();
    expect(
      screen.queryByText('Codex transport warning: websocket 503; run still active'),
    ).toBeNull();
  });

  it('does not create its own EventSource', async () => {
    const { fetchEventsPage } = await import('@/lib/api');
    vi.mocked(fetchEventsPage).mockResolvedValue({ events: [], hasMore: false });

    const { TimelineSection } = await import('./TimelineSection');
    renderTimeline(<TimelineSection projectSlug="p" id="1" workItemId="w1" />);

    await screen.findByText('No timeline events yet.');
    expect(MockEventSource.instances).toHaveLength(0);
  });

  it('renders named events from the shared events cache', async () => {
    const { fetchEventsPage } = await import('@/lib/api');
    const event = makeEvent(2, 'grill.decision-crystallized', {
      roundNumber: 2,
      decision: 'Use the shared event-kind contract.',
    });
    vi.mocked(fetchEventsPage).mockResolvedValue({ events: [event], hasMore: false });

    const queryClient = new QueryClient();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    const { TimelineSection } = await import('./TimelineSection');
    renderTimeline(<TimelineSection projectSlug="p" id="1" workItemId="w1" />, queryClient);

    expect(await screen.findByText('Decision crystallized')).toBeTruthy();
    expect(screen.getByText('Use the shared event-kind contract.')).toBeTruthy();
    expect(MockEventSource.instances).toHaveLength(0);
    expect(invalidatedQueryKey(invalidateSpy.mock.calls, ['events', 'p', '1'])).toBe(false);
  });

  it('renders the Playwright capture section from the shared events cache', async () => {
    const { fetchEventsPage } = await import('@/lib/api');
    vi.mocked(fetchEventsPage).mockResolvedValue({ events: [], hasMore: false });

    const queryClient = new QueryClient();
    queryClient.setQueryData(
      ['events', 'p', '1'],
      [
        makeEvent(2, 'state.transitioned', {
          from: 'factory:decomposing',
          to: 'factory:done',
        }),
        makeEvent(3, 'agent.investigation-complete', {
          playwrightRepro: {
            screenshots: [
              {
                path: '/tmp/repro.png',
                caption: 'Live repro screenshot',
                step: 1,
              },
            ],
            gifPath: null,
            consoleErrors: [],
            reproSteps: ['Open the bug page'],
            reproduced: true,
            notes: 'Captured from the live investigation event.',
          },
        }),
      ],
    );

    const { TimelineSection } = await import('./TimelineSection');
    const { PlaywrightCaptureSection } = await import('./PlaywrightCaptureSection');
    renderTimeline(
      <>
        <TimelineSection projectSlug="p" id="1" workItemId="w1" />
        <PlaywrightCaptureSection projectSlug="p" id="1" itemType="bug" />
      </>,
      queryClient,
    );

    expect(await screen.findByText('Open the bug page')).toBeTruthy();
    expect(screen.getByText('Live repro screenshot')).toBeTruthy();
    expect(MockEventSource.instances).toHaveLength(0);
  });

  it('does not render named chat events in issue timelines', async () => {
    const { fetchEventsPage } = await import('@/lib/api');
    vi.mocked(fetchEventsPage).mockResolvedValue({
      events: [
        makeEvent(2, 'chat.agent-message', {
          conversationId: 'conv_1',
          text: 'chat reply should stay in chat',
        }),
      ],
      hasMore: false,
    });

    const { TimelineSection } = await import('./TimelineSection');
    renderTimeline(<TimelineSection projectSlug="p" id="1" workItemId="w1" />);

    await screen.findByText('No timeline events yet.');
    expect(screen.queryByText('chat reply should stay in chat')).toBeNull();
    expect(MockEventSource.instances).toHaveLength(0);
  });

  it('does not render non-chat events emitted by the hub-chat skill', async () => {
    const { fetchEventsPage } = await import('@/lib/api');
    vi.mocked(fetchEventsPage).mockResolvedValue({
      events: [
        makeRunEvent(2, 'chat-run', 'agent.run-started', {
          skill: 'hub-chat',
          modelId: 'gpt-5.4',
          runtime: 'codex-cli',
        }),
      ],
      hasMore: false,
    });

    const { TimelineSection } = await import('./TimelineSection');
    renderTimeline(<TimelineSection projectSlug="p" id="1" workItemId="w1" />);

    await screen.findByText('No timeline events yet.');
    expect(screen.queryByText('hub-chat')).toBeNull();
    expect(MockEventSource.instances).toHaveLength(0);
  });

  it('renders intervention groups inside the main timeline instead of a top audit panel', async () => {
    const { fetchEventsPage, fetchIntervention, fetchIssueInterventions } = await import(
      '@/lib/api'
    );
    const intervention = makeIntervention();
    vi.mocked(fetchEventsPage).mockResolvedValue({
      events: [
        makePlainEvent(1, '2026-05-04T10:01:00Z'),
        makePlainEvent(2, '2026-05-04T10:05:00Z'),
      ],
      hasMore: false,
    });
    vi.mocked(fetchIssueInterventions).mockResolvedValue([intervention]);
    vi.mocked(fetchIntervention).mockResolvedValue(makeInterventionDetail(intervention));

    const { TimelineSection } = await import('./TimelineSection');
    renderTimeline(<TimelineSection projectSlug="p" id="1" workItemId="w1" />);

    await screen.findByText('Manual operator transition');
    expect(screen.queryByTestId('intervention-timeline-panel')).toBeNull();

    const timelineList = document.querySelector('[data-testid="timeline-section"] > ol');
    expect(timelineList).toBeTruthy();
    const children = Array.from(timelineList?.children ?? []);
    expect(children).toHaveLength(2);
    expect(children[0].getAttribute('data-intervention-id')).toBe(intervention.id);
    expect(children[1].getAttribute('data-timeline-section')).toBe('system');
    expect(children[1].querySelectorAll('[data-event-kind="system.note"]')).toHaveLength(2);
  });

  it('shows intervention groups instead of the empty state when there are no agent events', async () => {
    const { fetchEventsPage, fetchIntervention, fetchIssueInterventions } = await import(
      '@/lib/api'
    );
    const intervention = makeIntervention();
    vi.mocked(fetchEventsPage).mockResolvedValue({ events: [], hasMore: false });
    vi.mocked(fetchIssueInterventions).mockResolvedValue([intervention]);
    vi.mocked(fetchIntervention).mockResolvedValue(makeInterventionDetail(intervention));

    const { TimelineSection } = await import('./TimelineSection');
    renderTimeline(<TimelineSection projectSlug="p" id="1" workItemId="w1" />);

    await screen.findByText('Manual operator transition');
    expect(screen.queryByText('No timeline events yet.')).toBeNull();
  });

  it('expand and collapse all controls intervention accordions', async () => {
    const { fetchEventsPage, fetchIntervention, fetchIssueInterventions } = await import(
      '@/lib/api'
    );
    const intervention = makeIntervention();
    vi.mocked(fetchEventsPage).mockResolvedValue({ events: [], hasMore: false });
    vi.mocked(fetchIssueInterventions).mockResolvedValue([intervention]);
    vi.mocked(fetchIntervention).mockResolvedValue(makeInterventionDetail(intervention));

    const { TimelineSection } = await import('./TimelineSection');
    renderTimeline(<TimelineSection projectSlug="p" id="1" workItemId="w1" />);

    await screen.findByText('Manual operator transition');
    const details = document.querySelector('[data-intervention-id] details') as HTMLDetailsElement;
    expect(details.open).toBe(false);

    fireEvent.click(screen.getByTestId('timeline-expand-all'));
    await waitFor(() => expect(details.open).toBe(true));

    fireEvent.click(screen.getByTestId('timeline-collapse-all'));
    await waitFor(() => expect(details.open).toBe(false));
  });
});
