import type { AgentResult } from '@goose-hub/core/agent-runtime/interface.js';
import type { StateSource, WorkItem } from '@goose-hub/core/state-source/interface.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ─── module mocks ──────────────────────────────────────────────────────────────

vi.mock('#shared/projects.js', () => ({ getProject: vi.fn().mockResolvedValue(null) }));
vi.mock('#shared/source.js', () => ({
  isValidSlug: (s: string) => /^[a-z0-9-]+$/.test(s),
  getSourceForSlug: vi.fn().mockResolvedValue({
    projectId: 'goose-hub-self',
    repoRef: 'shaunnez/goose-hub',
    listOpenWork: vi.fn().mockResolvedValue([]),
    listClosedWorkByMilestone: vi.fn().mockResolvedValue([]),
    listWorkByMilestone: vi.fn().mockResolvedValue([]),
    getItem: vi.fn(),
    listMilestones: vi.fn().mockResolvedValue([]),
    getActiveMilestone: vi.fn().mockResolvedValue(null),
    transitionState: vi.fn().mockResolvedValue(undefined),
    forceState: vi.fn().mockResolvedValue(undefined),
    comment: vi.fn().mockResolvedValue(undefined),
    listComments: vi.fn().mockResolvedValue([]),
    setMilestone: vi.fn().mockResolvedValue(undefined),
    setLabelInGroup: vi.fn().mockResolvedValue(undefined),
    attach: vi.fn().mockResolvedValue(undefined),
    createIssue: vi.fn(),
    createMilestone: vi.fn(),
    updateMilestone: vi.fn(),
    deleteMilestone: vi.fn(),
    getPrDiff: vi.fn().mockResolvedValue(''),
    addLabels: vi.fn(),
    removeLabel: vi.fn(),
    listLabels: vi.fn().mockResolvedValue([]),
    watchForUpdates: vi.fn(),
  }),
}));
vi.mock('#shared/budget.js', () => ({
  checkDailyBudget: vi.fn().mockResolvedValue({
    exceeded: false,
    usage: { totalCostUsd: 0, totalTokens: 0 },
    limitTokens: 0,
  }),
}));

vi.mock('@goose-hub/core/agent-runtime/claude-cli.js', () => ({
  ClaudeCliRuntime: vi.fn().mockImplementation(() => ({
    run: vi.fn(),
  })),
}));

vi.mock('@goose-hub/core/agent-runtime/schema-bridge.js', () => ({
  toJsonSchema: vi.fn().mockReturnValue({}),
}));

vi.mock('@goose-hub/core/agent-runtime/select-persona.js', () => ({
  selectPersona: vi
    .fn()
    .mockReturnValue({ personaId: 'goose-hub-self/triager/0', codename: 'Grey Honker' }),
}));

vi.mock('@goose-hub/core/event-stream/store.js', () => ({
  eventStore: {
    appendEvent: vi
      .fn()
      .mockReturnValue({ id: 1, kind: 'agent.triage-complete', payload: {}, createdAt: '' }),
  },
}));

const mockAccumulatePersonaStats = vi.fn();
vi.mock('@goose-hub/core/persona/accumulate.js', () => ({
  accumulatePersonaStats: mockAccumulatePersonaStats,
}));

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return { ...actual, readFileSync: vi.fn().mockReturnValue('# mock prompt') };
});

// ─── helpers ──────────────────────────────────────────────────────────────────

function makeWorkItem(overrides: Partial<WorkItem> = {}): WorkItem {
  return {
    id: 'github:shaunnez/goose-hub#42',
    externalId: '42',
    repoRef: 'shaunnez/goose-hub',
    title: 'Fix triage bug',
    body: 'Triage fails on empty body.',
    type: 'bug',
    priority: 'high',
    mode: 'supervised',
    state: 'factory:triaging',
    authorIsOwner: true,
    schedule: 'current',
    exec: 'serial',
    dependsOn: [],
    blocks: [],
    createdAt: new Date(),
    ...overrides,
  };
}

function makeTriageOutput() {
  return {
    type: 'bug',
    priority: 'p1',
    labels: [],
    reasoning: 'Clearly a bug.',
    decisionSummaries: [{ kind: 'PLAN', summary: 'Bug' }],
  };
}

function makeRepoMatchOutput() {
  return {
    candidates: [
      { repo: 'shaunnez/goose-hub', confidence: 90, evidence: 'slug match', tier: 1 as const },
    ],
    decisionSummaries: [{ kind: 'PLAN', summary: 'Matched via slug token' }],
  };
}

function makeMockSource(items: WorkItem[] = []): StateSource {
  return {
    projectId: 'goose-hub-self',
    repoRef: 'shaunnez/goose-hub',
    listOpenWork: vi.fn().mockResolvedValue(items),
    listClosedWorkByMilestone: vi.fn().mockResolvedValue([]),
    listWorkByMilestone: vi.fn().mockResolvedValue([]),
    getItem: vi.fn(),
    listMilestones: vi.fn().mockResolvedValue([]),
    getActiveMilestone: vi.fn().mockResolvedValue(null),
    transitionState: vi.fn().mockResolvedValue(undefined),
    forceState: vi.fn().mockResolvedValue(undefined),
    comment: vi.fn().mockResolvedValue(undefined),
    listComments: vi.fn().mockResolvedValue([]),
    setMilestone: vi.fn().mockResolvedValue(undefined),
    setLabelInGroup: vi.fn().mockResolvedValue(undefined),
    attach: vi.fn().mockResolvedValue(undefined),
    createIssue: vi.fn(),
    createMilestone: vi.fn(),
    updateMilestone: vi.fn(),
    deleteMilestone: vi.fn(),
    getPrDiff: vi.fn().mockResolvedValue(''),
    addLabels: vi.fn(),
    removeLabel: vi.fn(),
    listLabels: vi.fn().mockResolvedValue([]),
    watchForUpdates: vi.fn(),
  };
}

// ─── tests ────────────────────────────────────────────────────────────────────

describe('runTriageBatch', () => {
  let mockRuntime: { run: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    vi.clearAllMocks();
    const { ClaudeCliRuntime } = await import('@goose-hub/core/agent-runtime/claude-cli.js');
    mockRuntime = new (ClaudeCliRuntime as unknown as new () => typeof mockRuntime)();
    vi.mocked(ClaudeCliRuntime).mockImplementation(() => mockRuntime as never);
  });

  it('skips items not in factory:triaging state', async () => {
    const source = makeMockSource([makeWorkItem({ state: 'factory:accepted' })]);
    const { runTriageBatch } = await import('./triage-batch.js');
    await runTriageBatch('goose-hub-self', source);
    expect(mockRuntime.run).not.toHaveBeenCalled();
  });

  it('runs triage and repo-match for each triaging item', async () => {
    const item = makeWorkItem();
    const source = makeMockSource([item]);

    mockRuntime.run
      .mockResolvedValueOnce({
        output: makeTriageOutput(),
        decisionSummaries: [],
        events: [],
      } satisfies AgentResult)
      .mockResolvedValueOnce({
        output: makeRepoMatchOutput(),
        decisionSummaries: [],
        events: [],
      } satisfies AgentResult);

    const { runTriageBatch } = await import('./triage-batch.js');
    await runTriageBatch('goose-hub-self', source);

    expect(mockRuntime.run).toHaveBeenCalledTimes(2);
  });

  it('passes repos context to repo-match skill', async () => {
    const item = makeWorkItem();
    const source = makeMockSource([item]);

    mockRuntime.run
      .mockResolvedValueOnce({
        output: makeTriageOutput(),
        decisionSummaries: [],
        events: [],
      } satisfies AgentResult)
      .mockResolvedValueOnce({
        output: makeRepoMatchOutput(),
        decisionSummaries: [],
        events: [],
      } satisfies AgentResult);

    const { runTriageBatch } = await import('./triage-batch.js');
    await runTriageBatch('goose-hub-self', source);

    const repoMatchCall = mockRuntime.run.mock.calls[1][0] as {
      context: Record<string, unknown>;
      contextAllowlist: string[];
    };
    expect(repoMatchCall.context).toHaveProperty('repos');
    expect(repoMatchCall.contextAllowlist).toContain('repos');
  });

  it('applies type and priority labels', async () => {
    const item = makeWorkItem();
    const source = makeMockSource([item]);

    mockRuntime.run
      .mockResolvedValueOnce({
        output: makeTriageOutput(),
        decisionSummaries: [],
        events: [],
      } satisfies AgentResult)
      .mockResolvedValueOnce({
        output: makeRepoMatchOutput(),
        decisionSummaries: [],
        events: [],
      } satisfies AgentResult);

    const { runTriageBatch } = await import('./triage-batch.js');
    await runTriageBatch('goose-hub-self', source);

    expect(source.setLabelInGroup).toHaveBeenCalledWith('42', 'type', 'bug');
    expect(source.setLabelInGroup).toHaveBeenCalledWith('42', 'priority', 'high');
  });

  it('maps p0→critical, p1→high, p2→medium, p3→low', async () => {
    const priorities: Array<[string, string]> = [
      ['p0', 'critical'],
      ['p1', 'high'],
      ['p2', 'medium'],
      ['p3', 'low'],
    ];

    for (const [p, expected] of priorities) {
      vi.clearAllMocks();
      const item = makeWorkItem();
      const source = makeMockSource([item]);

      const { ClaudeCliRuntime } = await import('@goose-hub/core/agent-runtime/claude-cli.js');
      const rt = new (ClaudeCliRuntime as unknown as new () => typeof mockRuntime)();
      vi.mocked(ClaudeCliRuntime).mockImplementation(() => rt as never);
      rt.run
        .mockResolvedValueOnce({
          output: { ...makeTriageOutput(), priority: p },
          decisionSummaries: [],
          events: [],
        } satisfies AgentResult)
        .mockResolvedValueOnce({
          output: makeRepoMatchOutput(),
          decisionSummaries: [],
          events: [],
        } satisfies AgentResult);

      const { runTriageBatch } = await import('./triage-batch.js');
      await runTriageBatch('goose-hub-self', source);
      expect(source.setLabelInGroup).toHaveBeenCalledWith('42', 'priority', expected);
    }
  });

  it('posts triage comment with correct format', async () => {
    const item = makeWorkItem();
    const source = makeMockSource([item]);

    mockRuntime.run
      .mockResolvedValueOnce({
        output: makeTriageOutput(),
        decisionSummaries: [],
        events: [],
      } satisfies AgentResult)
      .mockResolvedValueOnce({
        output: makeRepoMatchOutput(),
        decisionSummaries: [],
        events: [],
      } satisfies AgentResult);

    const { runTriageBatch } = await import('./triage-batch.js');
    await runTriageBatch('goose-hub-self', source);

    const commentArg = vi.mocked(source.comment).mock.calls[0][1];
    expect(commentArg).toContain('**Triage complete**');
    expect(commentArg).toContain('Type: bug');
    expect(commentArg).toContain('Priority: p1');
    expect(commentArg).toContain('shaunnez/goose-hub');
  });

  it('stores agent.triage-complete event', async () => {
    const item = makeWorkItem();
    const source = makeMockSource([item]);

    mockRuntime.run
      .mockResolvedValueOnce({
        output: makeTriageOutput(),
        decisionSummaries: [],
        events: [],
      } satisfies AgentResult)
      .mockResolvedValueOnce({
        output: makeRepoMatchOutput(),
        decisionSummaries: [],
        events: [],
      } satisfies AgentResult);

    const { runTriageBatch } = await import('./triage-batch.js');
    const { eventStore } = await import('@goose-hub/core/event-stream/store.js');
    await runTriageBatch('goose-hub-self', source);

    const call = vi
      .mocked(eventStore.appendEvent)
      .mock.calls.find(([e]) => e.kind === 'agent.triage-complete');
    expect(call).toBeDefined();
  });

  it('transitions state from factory:triaging to factory:accepted', async () => {
    const item = makeWorkItem();
    const source = makeMockSource([item]);

    mockRuntime.run
      .mockResolvedValueOnce({
        output: makeTriageOutput(),
        decisionSummaries: [],
        events: [],
      } satisfies AgentResult)
      .mockResolvedValueOnce({
        output: makeRepoMatchOutput(),
        decisionSummaries: [],
        events: [],
      } satisfies AgentResult);

    const { runTriageBatch } = await import('./triage-batch.js');
    await runTriageBatch('goose-hub-self', source);

    expect(source.transitionState).toHaveBeenCalledWith(
      '42',
      'factory:triaging',
      'factory:accepted',
    );
  });

  it('accumulates persona stats for both triager and researcher on success', async () => {
    const item = makeWorkItem();
    const source = makeMockSource([item]);

    mockRuntime.run
      .mockResolvedValueOnce({
        output: makeTriageOutput(),
        decisionSummaries: [],
        events: [],
      } satisfies AgentResult)
      .mockResolvedValueOnce({
        output: makeRepoMatchOutput(),
        decisionSummaries: [],
        events: [],
      } satisfies AgentResult);

    const { runTriageBatch } = await import('./triage-batch.js');
    await runTriageBatch('goose-hub-self', source);

    const calls = mockAccumulatePersonaStats.mock.calls.map(([arg]) => arg);
    expect(calls).toContainEqual(expect.objectContaining({ role: 'triager', outcome: 'success' }));
    expect(calls).toContainEqual(
      expect.objectContaining({ role: 'researcher', outcome: 'success' }),
    );
  });

  it('records triager failure when triage output validation fails', async () => {
    const item = makeWorkItem();
    const source = makeMockSource([item]);

    mockRuntime.run.mockResolvedValueOnce({
      output: { bad: 'data' },
      decisionSummaries: [],
      events: [],
    } satisfies AgentResult);

    const { runTriageBatch } = await import('./triage-batch.js');
    await runTriageBatch('goose-hub-self', source);

    const calls = mockAccumulatePersonaStats.mock.calls.map(([arg]) => arg);
    expect(calls).toContainEqual(expect.objectContaining({ role: 'triager', outcome: 'failure' }));
    // researcher never ran since triage parse failed and continued
    expect(calls).not.toContainEqual(expect.objectContaining({ role: 'researcher' }));
  });

  it('records researcher failure when repo-match output validation fails', async () => {
    const item = makeWorkItem();
    const source = makeMockSource([item]);

    mockRuntime.run
      .mockResolvedValueOnce({
        output: makeTriageOutput(),
        decisionSummaries: [],
        events: [],
      } satisfies AgentResult)
      .mockResolvedValueOnce({
        output: { bad: 'data' },
        decisionSummaries: [],
        events: [],
      } satisfies AgentResult);

    const { runTriageBatch } = await import('./triage-batch.js');
    await runTriageBatch('goose-hub-self', source);

    const calls = mockAccumulatePersonaStats.mock.calls.map(([arg]) => arg);
    expect(calls).toContainEqual(expect.objectContaining({ role: 'triager', outcome: 'success' }));
    expect(calls).toContainEqual(
      expect.objectContaining({ role: 'researcher', outcome: 'failure' }),
    );
  });

  it('skips item and continues if triage output validation fails', async () => {
    const items = [makeWorkItem({ externalId: '1' }), makeWorkItem({ externalId: '2' })];
    const source = makeMockSource(items);

    mockRuntime.run
      .mockResolvedValueOnce({
        output: { bad: 'data' },
        decisionSummaries: [],
        events: [],
      } satisfies AgentResult)
      .mockResolvedValueOnce({
        output: makeTriageOutput(),
        decisionSummaries: [],
        events: [],
      } satisfies AgentResult)
      .mockResolvedValueOnce({
        output: makeRepoMatchOutput(),
        decisionSummaries: [],
        events: [],
      } satisfies AgentResult);

    const { runTriageBatch } = await import('./triage-batch.js');
    await runTriageBatch('goose-hub-self', source);

    // First item skipped (invalid output), second item fully processed
    expect(source.transitionState).not.toHaveBeenCalledWith(
      '1',
      expect.anything(),
      expect.anything(),
    );
    expect(source.transitionState).toHaveBeenCalledWith(
      '2',
      'factory:triaging',
      'factory:accepted',
    );
  });
});

describe('POST /projects/:slug/tick', () => {
  it('returns 200 with ok: true', async () => {
    const { app } = await import('../../server.js');
    const res = await app.request('/projects/goose-hub-self/tick', { method: 'POST' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; slug: string };
    expect(body.ok).toBe(true);
    expect(body.slug).toBe('goose-hub-self');
  });
});

describe('runTriageBatch decision-summary events (#206)', () => {
  let mockRuntime: { run: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    vi.clearAllMocks();
    const { ClaudeCliRuntime } = await import('@goose-hub/core/agent-runtime/claude-cli.js');
    mockRuntime = new (ClaudeCliRuntime as unknown as new () => typeof mockRuntime)();
    vi.mocked(ClaudeCliRuntime).mockImplementation(() => mockRuntime as never);
  });

  it('emits one agent.decision-summary per triage decisionSummaries entry', async () => {
    const item = makeWorkItem();
    const source = makeMockSource([item]);

    const triageOut = makeTriageOutput();
    triageOut.decisionSummaries = [
      { kind: 'PLAN', summary: 'Bug — code error in service' },
      { kind: 'ESCALATE', summary: 'p1 — blocks production' },
    ];

    mockRuntime.run
      .mockResolvedValueOnce({
        output: triageOut,
        decisionSummaries: [],
        events: [],
      } satisfies AgentResult)
      .mockResolvedValueOnce({
        output: makeRepoMatchOutput(),
        decisionSummaries: [],
        events: [],
      } satisfies AgentResult);

    const { eventStore } = await import('@goose-hub/core/event-stream/store.js');
    const { runTriageBatch } = await import('./triage-batch.js');
    await runTriageBatch('goose-hub-self', source);

    const calls = vi.mocked(eventStore.appendEvent).mock.calls;
    const triageDecisionEvents = calls.filter(
      ([e]) =>
        e.kind === 'agent.decision-summary' && (e.payload as { skill?: string }).skill === 'triage',
    );
    expect(triageDecisionEvents).toHaveLength(2);
    expect((triageDecisionEvents[0][0].payload as { kind: string }).kind).toBe('PLAN');
  });

  it('emits agent.decision-summary events for repo-match decisionSummaries', async () => {
    const item = makeWorkItem();
    const source = makeMockSource([item]);

    mockRuntime.run
      .mockResolvedValueOnce({
        output: makeTriageOutput(),
        decisionSummaries: [],
        events: [],
      } satisfies AgentResult)
      .mockResolvedValueOnce({
        output: makeRepoMatchOutput(),
        decisionSummaries: [],
        events: [],
      } satisfies AgentResult);

    const { eventStore } = await import('@goose-hub/core/event-stream/store.js');
    const { runTriageBatch } = await import('./triage-batch.js');
    await runTriageBatch('goose-hub-self', source);

    const repoMatchDecisionEvents = vi
      .mocked(eventStore.appendEvent)
      .mock.calls.filter(
        ([e]) =>
          e.kind === 'agent.decision-summary' &&
          (e.payload as { skill?: string }).skill === 'repo-match',
      );
    expect(repoMatchDecisionEvents).toHaveLength(1);
    expect((repoMatchDecisionEvents[0][0].payload as { kind: string }).kind).toBe('PLAN');
  });

  it('emits agent.run-failed when repo-match output fails to parse', async () => {
    const item = makeWorkItem();
    const source = makeMockSource([item]);

    mockRuntime.run
      .mockResolvedValueOnce({
        output: makeTriageOutput(),
        decisionSummaries: [],
        events: [],
      } satisfies AgentResult)
      .mockResolvedValueOnce({
        output: { not: 'a-valid-repo-match-output' },
        decisionSummaries: [],
        events: [],
      } satisfies AgentResult);

    const { eventStore } = await import('@goose-hub/core/event-stream/store.js');
    const { runTriageBatch } = await import('./triage-batch.js');
    await runTriageBatch('goose-hub-self', source);

    const failedEvents = vi
      .mocked(eventStore.appendEvent)
      .mock.calls.filter(
        ([e]) =>
          e.kind === 'agent.run-failed' &&
          (e.payload as { error?: string }).error === 'repo-match output validation failed',
      );
    expect(failedEvents).toHaveLength(1);
  });
});

describe('runTriageBatch onward routing after accept', () => {
  let mockRuntime: { run: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    vi.clearAllMocks();
    const { ClaudeCliRuntime } = await import('@goose-hub/core/agent-runtime/claude-cli.js');
    mockRuntime = new (ClaudeCliRuntime as unknown as new () => typeof mockRuntime)();
    vi.mocked(ClaudeCliRuntime).mockImplementation(() => mockRuntime as never);
  });

  it('routes type:bug to factory:investigating after accepting', async () => {
    const source = makeMockSource([makeWorkItem()]);
    mockRuntime.run
      .mockResolvedValueOnce({
        output: { ...makeTriageOutput(), type: 'bug' },
        decisionSummaries: [],
        events: [],
      } satisfies AgentResult)
      .mockResolvedValueOnce({
        output: makeRepoMatchOutput(),
        decisionSummaries: [],
        events: [],
      } satisfies AgentResult);

    const { runTriageBatch } = await import('./triage-batch.js');
    await runTriageBatch('goose-hub-self', source);

    expect(source.transitionState).toHaveBeenCalledWith(
      '42',
      'factory:accepted',
      'factory:investigating',
    );
  });

  it('routes type:chore to factory:dev-ready after accepting', async () => {
    const source = makeMockSource([makeWorkItem()]);
    mockRuntime.run
      .mockResolvedValueOnce({
        output: { ...makeTriageOutput(), type: 'chore' },
        decisionSummaries: [],
        events: [],
      } satisfies AgentResult)
      .mockResolvedValueOnce({
        output: makeRepoMatchOutput(),
        decisionSummaries: [],
        events: [],
      } satisfies AgentResult);

    const { runTriageBatch } = await import('./triage-batch.js');
    await runTriageBatch('goose-hub-self', source);

    expect(source.transitionState).toHaveBeenCalledWith(
      '42',
      'factory:accepted',
      'factory:dev-ready',
    );
  });

  it('routes type:feature with factory:from-prd to factory:dev-ready after accepting', async () => {
    const source = makeMockSource([makeWorkItem()]);
    // Seed the from-prd label so triage recognises it as a decomposed child
    // biome-ignore lint/style/noNonNullAssertion: mock source always defines listLabels
    vi.mocked(source.listLabels!).mockResolvedValue(['factory:accepted', 'factory:from-prd']);
    mockRuntime.run
      .mockResolvedValueOnce({
        output: { ...makeTriageOutput(), type: 'feature' },
        decisionSummaries: [],
        events: [],
      } satisfies AgentResult)
      .mockResolvedValueOnce({
        output: makeRepoMatchOutput(),
        decisionSummaries: [],
        events: [],
      } satisfies AgentResult);

    const { runTriageBatch } = await import('./triage-batch.js');
    await runTriageBatch('goose-hub-self', source);

    expect(source.transitionState).toHaveBeenCalledWith(
      '42',
      'factory:accepted',
      'factory:dev-ready',
    );
  });

  it('routes fresh type:feature (no factory:from-prd) to factory:grilling after accepting', async () => {
    const source = makeMockSource([makeWorkItem()]);
    // No factory:from-prd label — default mock returns []
    mockRuntime.run
      .mockResolvedValueOnce({
        output: { ...makeTriageOutput(), type: 'feature' },
        decisionSummaries: [],
        events: [],
      } satisfies AgentResult)
      .mockResolvedValueOnce({
        output: makeRepoMatchOutput(),
        decisionSummaries: [],
        events: [],
      } satisfies AgentResult);

    const { runTriageBatch } = await import('./triage-batch.js');
    await runTriageBatch('goose-hub-self', source);

    expect(source.transitionState).toHaveBeenCalledWith(
      '42',
      'factory:accepted',
      'factory:grilling',
    );
  });

  it('routes type:research to factory:research-pending after accepting', async () => {
    const source = makeMockSource([makeWorkItem()]);
    mockRuntime.run
      .mockResolvedValueOnce({
        output: { ...makeTriageOutput(), type: 'research' },
        decisionSummaries: [],
        events: [],
      } satisfies AgentResult)
      .mockResolvedValueOnce({
        output: makeRepoMatchOutput(),
        decisionSummaries: [],
        events: [],
      } satisfies AgentResult);

    const { runTriageBatch } = await import('./triage-batch.js');
    await runTriageBatch('goose-hub-self', source);

    expect(source.transitionState).toHaveBeenCalledWith(
      '42',
      'factory:accepted',
      'factory:research-pending',
    );
  });
});

describe('runTriageBatch budget gate (#283)', () => {
  let mockRuntime: { run: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    vi.clearAllMocks();
    const { ClaudeCliRuntime } = await import('@goose-hub/core/agent-runtime/claude-cli.js');
    mockRuntime = new (ClaudeCliRuntime as unknown as new () => typeof mockRuntime)();
    vi.mocked(ClaudeCliRuntime).mockImplementation(() => mockRuntime as never);
  });

  it('skips the tick and emits project.budget-exceeded when daily token limit is exceeded', async () => {
    const { getProject } = await import('#shared/projects.js');
    const { checkDailyBudget } = await import('#shared/budget.js');
    vi.mocked(getProject).mockResolvedValue({
      id: 'goose-hub-self',
      slug: 'goose-hub-self',
      name: 'Goose Hub',
      source: { kind: 'github-labels', repo: 'shaunnez/goose-hub' },
      activeMilestone: null,
      colorStripe: '#000',
      budgets: { perWorkflowMaxUsd: 1, dailyTokens: 500_000, perAdvisorMaxUsd: 0.5 },
      mode: 'supervised',
    } as never);
    vi.mocked(checkDailyBudget).mockResolvedValue({
      exceeded: true,
      reason: 'daily-tokens',
      usage: { totalCostUsd: 1.5, totalTokens: 550_000 },
      limitTokens: 500_000,
    });

    const source = makeMockSource([makeWorkItem()]);
    const { eventStore } = await import('@goose-hub/core/event-stream/store.js');
    const { runTriageBatch } = await import('./triage-batch.js');
    await runTriageBatch('goose-hub-self', source);

    expect(mockRuntime.run).not.toHaveBeenCalled();
    const budgetEvent = vi
      .mocked(eventStore.appendEvent)
      .mock.calls.find(([e]) => e.kind === 'project.budget-exceeded');
    expect(budgetEvent).toBeDefined();
    expect((budgetEvent?.[0].payload as { limitTokens: number }).limitTokens).toBe(500_000);
  });

  it('proceeds normally when budget is not exceeded', async () => {
    const { getProject } = await import('#shared/projects.js');
    const { checkDailyBudget } = await import('#shared/budget.js');
    vi.mocked(getProject).mockResolvedValue({
      id: 'goose-hub-self',
      slug: 'goose-hub-self',
      name: 'Goose Hub',
      source: { kind: 'github-labels', repo: 'shaunnez/goose-hub' },
      activeMilestone: null,
      colorStripe: '#000',
      budgets: { perWorkflowMaxUsd: 1, dailyTokens: 500_000, perAdvisorMaxUsd: 0.5 },
      mode: 'supervised',
    } as never);
    vi.mocked(checkDailyBudget).mockResolvedValue({
      exceeded: false,
      usage: { totalCostUsd: 0.1, totalTokens: 10_000 },
      limitTokens: 500_000,
    });

    mockRuntime.run
      .mockResolvedValueOnce({
        output: makeTriageOutput(),
        decisionSummaries: [],
        events: [],
      } satisfies AgentResult)
      .mockResolvedValueOnce({
        output: makeRepoMatchOutput(),
        decisionSummaries: [],
        events: [],
      } satisfies AgentResult);

    const source = makeMockSource([makeWorkItem()]);
    const { runTriageBatch } = await import('./triage-batch.js');
    await runTriageBatch('goose-hub-self', source);

    expect(mockRuntime.run).toHaveBeenCalledTimes(2);
  });

  it('skips proj-a when over budget but runs proj-b when under budget', async () => {
    const { getProject } = await import('#shared/projects.js');
    const { checkDailyBudget } = await import('#shared/budget.js');

    vi.mocked(getProject).mockResolvedValue({
      id: 'proj-a',
      slug: 'proj-a',
      name: 'Proj A',
      source: { kind: 'github-labels', repo: 'org/proj-a' },
      activeMilestone: null,
      colorStripe: '#f00',
      budgets: { perWorkflowMaxUsd: 1, dailyTokens: 500_000, perAdvisorMaxUsd: 0.5 },
      mode: 'supervised',
    } as never);
    vi.mocked(checkDailyBudget).mockResolvedValueOnce({
      exceeded: true,
      reason: 'daily-tokens',
      usage: { totalCostUsd: 2, totalTokens: 600_000 },
      limitTokens: 500_000,
    });

    const sourceA = makeMockSource([makeWorkItem()]);
    const { runTriageBatch } = await import('./triage-batch.js');
    await runTriageBatch('proj-a', sourceA);
    expect(mockRuntime.run).not.toHaveBeenCalled();

    vi.clearAllMocks();
    const { ClaudeCliRuntime } = await import('@goose-hub/core/agent-runtime/claude-cli.js');
    const rt = new (ClaudeCliRuntime as unknown as new () => typeof mockRuntime)();
    vi.mocked(ClaudeCliRuntime).mockImplementation(() => rt as never);
    rt.run
      .mockResolvedValueOnce({
        output: makeTriageOutput(),
        decisionSummaries: [],
        events: [],
      } satisfies AgentResult)
      .mockResolvedValueOnce({
        output: makeRepoMatchOutput(),
        decisionSummaries: [],
        events: [],
      } satisfies AgentResult);

    vi.mocked(getProject).mockResolvedValue({
      id: 'proj-b',
      slug: 'proj-b',
      name: 'Proj B',
      source: { kind: 'github-labels', repo: 'org/proj-b' },
      activeMilestone: null,
      colorStripe: '#0f0',
      budgets: { perWorkflowMaxUsd: 1, dailyTokens: 500_000, perAdvisorMaxUsd: 0.5 },
      mode: 'supervised',
    } as never);
    vi.mocked(checkDailyBudget).mockResolvedValueOnce({
      exceeded: false,
      usage: { totalCostUsd: 0.05, totalTokens: 5_000 },
      limitTokens: 500_000,
    });

    const sourceB = makeMockSource([makeWorkItem()]);
    await runTriageBatch('proj-b', sourceB);
    expect(rt.run).toHaveBeenCalledTimes(2);
  });
});

describe('runTriageBatch slug guard (#201)', () => {
  it('throws Invalid slug for path-traversal slug, before touching the filesystem', async () => {
    const { runTriageBatch } = await import('./triage-batch.js');
    // Provide an explicit (mock) source so we know the failure is from the slug
    // guard, not from getSourceForSlug returning null.
    const stubSource = {} as unknown as StateSource;
    await expect(runTriageBatch('../etc/hosts', stubSource)).rejects.toThrow(/Invalid slug/);
  });

  it('throws Invalid slug for empty slug', async () => {
    const { runTriageBatch } = await import('./triage-batch.js');
    const stubSource = {} as unknown as StateSource;
    await expect(runTriageBatch('', stubSource)).rejects.toThrow(/Invalid slug/);
  });

  it('throws Invalid slug for slashes in slug', async () => {
    const { runTriageBatch } = await import('./triage-batch.js');
    const stubSource = {} as unknown as StateSource;
    await expect(runTriageBatch('foo/bar', stubSource)).rejects.toThrow(/Invalid slug/);
  });
});
