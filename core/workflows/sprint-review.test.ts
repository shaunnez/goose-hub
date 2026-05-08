import type { AgentResult, AgentRuntime } from '@goose-hub/core/agent-runtime/interface.js';
import type { StateSource, WorkItem } from '@goose-hub/core/state-source/interface.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ─── module mocks ──────────────────────────────────────────────────────────────

const mockRun = vi.fn();

vi.mock('@goose-hub/core/agent-runtime/claude-cli.js', () => ({
  ClaudeCliRuntime: vi.fn().mockImplementation(() => ({ run: mockRun })),
}));

vi.mock('@goose-hub/core/agent-runtime/schema-bridge.js', () => ({
  toJsonSchema: vi.fn().mockReturnValue({}),
}));

vi.mock('@goose-hub/core/agent-runtime/select-persona.js', () => ({
  selectPersona: vi
    .fn()
    .mockReturnValue({ personaId: 'goose-hub-self/retrospector/0', codename: 'Grey Honker' }),
}));

vi.mock('@goose-hub/core/agent-runtime/read-prompt.js', () => ({
  readPromptWithContext: vi.fn().mockReturnValue('# mock sprint-review prompt'),
}));

const mockReplay = vi.fn().mockReturnValue([]);
vi.mock('@goose-hub/core/event-stream/store.js', () => ({
  eventStore: {
    appendEvent: vi.fn().mockReturnValue({ id: 1, kind: 'test', payload: {}, createdAt: '' }),
    replay: mockReplay,
  },
}));

vi.mock('@goose-hub/core/db/db.js', () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          all: () => [],
        }),
      }),
    }),
    insert: () => ({ values: () => ({ run: vi.fn() }) }),
  },
}));

const mockGetProjectBySlug = vi.fn();
vi.mock('@goose-hub/core/projects/loader.js', () => ({
  getProjectBySlug: mockGetProjectBySlug,
}));

// ─── helpers ──────────────────────────────────────────────────────────────────

function makeWorkItem(overrides: Partial<WorkItem> = {}): WorkItem {
  return {
    id: 'github:shaunnez/goose-hub#42',
    externalId: '42',
    repoRef: 'shaunnez/goose-hub',
    title: 'Test item',
    body: 'body',
    type: 'feature',
    priority: 'medium',
    mode: 'supervised',
    state: 'factory:done',
    authorIsOwner: true,
    schedule: 'current',
    exec: 'serial',
    dependsOn: [],
    blocks: [],
    createdAt: new Date(),
    milestoneId: '13',
    milestoneTitle: 'M13: Subagents',
    ...overrides,
  };
}

function makeMockSource(items: WorkItem[] = []): StateSource {
  return {
    projectId: 'goose-hub-self',
    repoRef: 'shaunnez/goose-hub',
    listOpenWork: vi.fn().mockResolvedValue(items),
    listClosedWorkByMilestone: vi.fn().mockResolvedValue([]),
    listWorkByMilestone: vi.fn().mockResolvedValue(items),
    getItem: vi.fn(),
    listMilestones: vi.fn().mockResolvedValue([]),
    getActiveMilestone: vi.fn().mockResolvedValue(null),
    transitionState: vi.fn().mockResolvedValue(undefined),
    forceState: vi.fn().mockResolvedValue(undefined),
    comment: vi.fn().mockResolvedValue(undefined),
    listComments: vi.fn().mockResolvedValue([]),
    setMilestone: vi.fn().mockResolvedValue(undefined),
    setLabelInGroup: vi.fn().mockResolvedValue(undefined),
    addLabels: vi.fn().mockResolvedValue(undefined),
    removeLabel: vi.fn().mockResolvedValue(undefined),
    listLabels: vi.fn().mockResolvedValue([]),
    attach: vi.fn().mockResolvedValue(undefined),
    createIssue: vi
      .fn()
      .mockResolvedValue(makeWorkItem({ externalId: '99', state: 'factory:done' })),
    createMilestone: vi.fn().mockResolvedValue(undefined),
    updateMilestone: vi.fn().mockResolvedValue(undefined),
    deleteMilestone: vi.fn().mockResolvedValue(undefined),
    getPrDiff: vi.fn().mockResolvedValue(''),
    watchForUpdates: vi.fn(),
  };
}

function makeSprintReviewOutput() {
  return {
    milestoneTitle: 'M13: Subagents',
    shipped: ['#42: Test item'],
    deferred: [],
    retroThemes: ['TDD discipline consistent'],
    nextSprintSuggestions: ['Add e2eCommand to project config.'],
    decisionSummaries: [
      { kind: 'VERDICT', summary: 'Sprint review complete for M13: 1 shipped, 0 deferred.' },
    ],
  };
}

function makeAgentResult(output: unknown): AgentResult {
  return { output, decisionSummaries: [], events: [] };
}

const SLUG = 'goose-hub-self';
const MILESTONE_TITLE = 'M13: Subagents';
const MILESTONE_NUMBER = 13;

beforeEach(() => {
  vi.clearAllMocks();
  mockRun.mockReset();
  mockReplay.mockReturnValue([]);
  mockGetProjectBySlug.mockResolvedValue(null);
});

// ─── tests ────────────────────────────────────────────────────────────────────

describe('runSprintReviewWorkflow', () => {
  it('reads milestone items from stateSource.listWorkByMilestone', async () => {
    const doneItem = makeWorkItem({ externalId: '42', state: 'factory:done' });
    const source = makeMockSource([doneItem]);
    mockRun.mockResolvedValueOnce(makeAgentResult(makeSprintReviewOutput()));

    const { runSprintReviewWorkflow } = await import('./sprint-review.js');
    await runSprintReviewWorkflow({
      projectId: SLUG,
      milestoneTitle: MILESTONE_TITLE,
      milestoneNumber: MILESTONE_NUMBER,
      stateSource: source,
    });

    expect(source.listWorkByMilestone).toHaveBeenCalledWith(MILESTONE_NUMBER);
  });

  it('calls runtime.run with skill=sprint-review and role=retrospector', async () => {
    const doneItem = makeWorkItem({ externalId: '42', state: 'factory:done' });
    const source = makeMockSource([doneItem]);
    mockRun.mockResolvedValueOnce(makeAgentResult(makeSprintReviewOutput()));

    const { runSprintReviewWorkflow } = await import('./sprint-review.js');
    await runSprintReviewWorkflow({
      projectId: SLUG,
      milestoneTitle: MILESTONE_TITLE,
      milestoneNumber: MILESTONE_NUMBER,
      stateSource: source,
    });

    expect(mockRun).toHaveBeenCalledTimes(1);
    const callArg = mockRun.mock.calls[0]?.[0] as { skill?: string; role?: string };
    expect(callArg.skill).toBe('sprint-review');
    expect(callArg.role).toBe('retrospector');
  });

  it('passes milestone context to the runtime', async () => {
    const doneItem = makeWorkItem({ externalId: '42', state: 'factory:done' });
    const source = makeMockSource([doneItem]);
    mockRun.mockResolvedValueOnce(makeAgentResult(makeSprintReviewOutput()));

    const { runSprintReviewWorkflow } = await import('./sprint-review.js');
    await runSprintReviewWorkflow({
      projectId: SLUG,
      milestoneTitle: MILESTONE_TITLE,
      milestoneNumber: MILESTONE_NUMBER,
      stateSource: source,
    });

    const callArg = mockRun.mock.calls[0]?.[0] as {
      context?: { milestone?: { title?: string; number?: number } };
    };
    expect(callArg.context?.milestone?.title).toBe(MILESTONE_TITLE);
    expect(callArg.context?.milestone?.number).toBe(MILESTONE_NUMBER);
  });

  it('creates a sprint review issue with the correct title', async () => {
    const doneItem = makeWorkItem({ externalId: '42', state: 'factory:done' });
    const source = makeMockSource([doneItem]);
    mockRun.mockResolvedValueOnce(makeAgentResult(makeSprintReviewOutput()));

    const { runSprintReviewWorkflow } = await import('./sprint-review.js');
    await runSprintReviewWorkflow({
      projectId: SLUG,
      milestoneTitle: MILESTONE_TITLE,
      milestoneNumber: MILESTONE_NUMBER,
      stateSource: source,
    });

    expect(source.createIssue).toHaveBeenCalledWith(
      expect.objectContaining({
        title: `Sprint Review: ${MILESTONE_TITLE}`,
        type: 'chore',
      }),
    );
  });

  it('includes shipped items in the issue body', async () => {
    const doneItem = makeWorkItem({ externalId: '42', state: 'factory:done' });
    const source = makeMockSource([doneItem]);
    mockRun.mockResolvedValueOnce(
      makeAgentResult({
        ...makeSprintReviewOutput(),
        shipped: ['#42: Shipped feature A'],
      }),
    );

    const { runSprintReviewWorkflow } = await import('./sprint-review.js');
    await runSprintReviewWorkflow({
      projectId: SLUG,
      milestoneTitle: MILESTONE_TITLE,
      milestoneNumber: MILESTONE_NUMBER,
      stateSource: source,
    });

    const createCall = (source.createIssue as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as {
      body?: string;
    };
    expect(createCall.body).toContain('#42: Shipped feature A');
  });

  it('calls addLabels with factory:docs on the created issue', async () => {
    const doneItem = makeWorkItem({ externalId: '42', state: 'factory:done' });
    const source = makeMockSource([doneItem]);
    mockRun.mockResolvedValueOnce(makeAgentResult(makeSprintReviewOutput()));

    const { runSprintReviewWorkflow } = await import('./sprint-review.js');
    await runSprintReviewWorkflow({
      projectId: SLUG,
      milestoneTitle: MILESTONE_TITLE,
      milestoneNumber: MILESTONE_NUMBER,
      stateSource: source,
    });

    expect(source.addLabels).toHaveBeenCalledTimes(1);
    expect(source.addLabels).toHaveBeenCalledWith('99', ['factory:docs']);
  });

  it('transitions created issue from factory:triaging to factory:done', async () => {
    const doneItem = makeWorkItem({ externalId: '42', state: 'factory:done' });
    const source = makeMockSource([doneItem]);
    mockRun.mockResolvedValueOnce(makeAgentResult(makeSprintReviewOutput()));

    const { runSprintReviewWorkflow } = await import('./sprint-review.js');
    await runSprintReviewWorkflow({
      projectId: SLUG,
      milestoneTitle: MILESTONE_TITLE,
      milestoneNumber: MILESTONE_NUMBER,
      stateSource: source,
    });

    expect(source.transitionState).toHaveBeenCalledWith('99', 'factory:triaging', 'factory:done');
  });

  it('throws and emits agent.run-failed when schema validation fails', async () => {
    const doneItem = makeWorkItem({ externalId: '42', state: 'factory:done' });
    const source = makeMockSource([doneItem]);
    mockRun.mockResolvedValueOnce(makeAgentResult({ invalid: 'output' }));

    const { runSprintReviewWorkflow } = await import('./sprint-review.js');
    await expect(
      runSprintReviewWorkflow({
        projectId: SLUG,
        milestoneTitle: MILESTONE_TITLE,
        milestoneNumber: MILESTONE_NUMBER,
        stateSource: source,
      }),
    ).rejects.toThrow('sprint-review schema validation failed');
  });

  it('returns the issue number of the created issue', async () => {
    const doneItem = makeWorkItem({ externalId: '42', state: 'factory:done' });
    const source = makeMockSource([doneItem]);
    mockRun.mockResolvedValueOnce(makeAgentResult(makeSprintReviewOutput()));

    const { runSprintReviewWorkflow } = await import('./sprint-review.js');
    const result = await runSprintReviewWorkflow({
      projectId: SLUG,
      milestoneTitle: MILESTONE_TITLE,
      milestoneNumber: MILESTONE_NUMBER,
      stateSource: source,
    });

    expect(result.issueNumber).toBe(99);
  });

  it('uses deps.runtime when provided instead of ClaudeCliRuntime', async () => {
    const doneItem = makeWorkItem({ externalId: '42', state: 'factory:done' });
    const source = makeMockSource([doneItem]);
    const customMockRun = vi.fn().mockResolvedValueOnce(makeAgentResult(makeSprintReviewOutput()));
    const customRuntime = { run: customMockRun };

    const { runSprintReviewWorkflow } = await import('./sprint-review.js');
    await runSprintReviewWorkflow({
      projectId: SLUG,
      milestoneTitle: MILESTONE_TITLE,
      milestoneNumber: MILESTONE_NUMBER,
      stateSource: source,
      deps: {
        runtime: customRuntime as unknown as AgentRuntime,
      },
    });

    expect(customMockRun).toHaveBeenCalledTimes(1);
    expect(mockRun).not.toHaveBeenCalled();
  });
});
