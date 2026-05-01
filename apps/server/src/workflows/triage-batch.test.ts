import type { AgentResult } from '@goose-hub/core/agent-runtime/interface.js';
import type { StateSource, WorkItem } from '@goose-hub/core/state-source/interface.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ─── module mocks ──────────────────────────────────────────────────────────────

vi.mock('@goose-hub/core/agent-runtime/claude-cli.js', () => ({
  ClaudeCliRuntime: vi.fn().mockImplementation(() => ({
    run: vi.fn(),
  })),
}));

vi.mock('@goose-hub/core/agent-runtime/schema-bridge.js', () => ({
  toJsonSchema: vi.fn().mockReturnValue({}),
}));

vi.mock('@goose-hub/core/event-stream/store.js', () => ({
  eventStore: {
    appendEvent: vi
      .fn()
      .mockReturnValue({ id: 1, kind: 'agent.triage-complete', payload: {}, createdAt: '' }),
  },
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
    decisionSummaries: [{ step: 'type-classification', summary: 'Bug' }],
  };
}

function makeRepoMatchOutput() {
  return {
    candidates: [
      { repo: 'shaunnez/goose-hub', confidence: 90, evidence: 'slug match', tier: 1 as const },
    ],
    decisionSummaries: [{ step: 'keyword-match', summary: 'Matched via slug token' }],
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

    // Second item still processed
    expect(source.transitionState).toHaveBeenCalledTimes(1);
  });
});

describe('POST /projects/:slug/tick', () => {
  it('returns 202 with ok: true', async () => {
    const { app } = await import('../index.js');
    const res = await app.request('/projects/goose-hub-self/tick', { method: 'POST' });
    expect(res.status).toBe(202);
    const body = (await res.json()) as { ok: boolean; slug: string };
    expect(body.ok).toBe(true);
    expect(body.slug).toBe('goose-hub-self');
  });
});
