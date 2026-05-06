import type { AgentResult } from '@goose-hub/core/agent-runtime/interface.js';
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
  readPromptWithContext: vi.fn().mockReturnValue('# mock retrospective prompt'),
}));

const mockReplay = vi.fn().mockReturnValue([]);
vi.mock('@goose-hub/core/event-stream/store.js', () => ({
  eventStore: {
    appendEvent: vi.fn().mockReturnValue({ id: 1, kind: 'test', payload: {}, createdAt: '' }),
    replay: mockReplay,
  },
}));

vi.mock('@goose-hub/core/persona/accumulate.js', () => ({
  accumulatePersonaStats: vi.fn(),
}));

vi.mock('@goose-hub/core/db/db.js', () => ({
  db: { insert: () => ({ values: () => ({ run: vi.fn() }) }) },
}));

const mockGetProject = vi.fn();
vi.mock('../../shared/projects.js', () => ({ getProject: mockGetProject }));

const mockGetSourceForSlug = vi.fn();
vi.mock('../../shared/source.js', () => ({
  getSourceForSlug: mockGetSourceForSlug,
  isValidSlug: (s: string) => /^[a-zA-Z0-9_-]+$/.test(s),
}));

// ─── helpers ──────────────────────────────────────────────────────────────────

function makeWorkItem(overrides: Partial<WorkItem> = {}): WorkItem {
  return {
    id: 'github:shaunnez/goose-hub#42',
    externalId: '42',
    repoRef: 'shaunnez/goose-hub',
    title: 'Test retrospective',
    body: 'Retro fixture',
    type: 'feature',
    priority: 'medium',
    mode: 'supervised',
    state: 'factory:retrospecting',
    authorIsOwner: true,
    schedule: 'current',
    exec: 'serial',
    dependsOn: [],
    blocks: [],
    createdAt: new Date(),
    ...overrides,
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

function makeLightRetroOutput() {
  return {
    summary: 'All went well.',
    whatWorked: ['tests caught the bug'],
    whatDidnt: [],
    improvementCandidates: [],
    decisionSummaries: [{ kind: 'VERDICT', summary: 'Light retro complete' }],
  };
}

function makeDeepRetroOutput() {
  return {
    summary: 'QA failed; deep dive.',
    whatWorked: [],
    whatDidnt: ['missed an edge case'],
    rootCauses: ['no test for empty input'],
    improvementCandidates: [
      { kind: 'persona-tweak', suggestionText: 'Add empty-input check to QA prompt' },
    ],
    decisionSummaries: [{ kind: 'VERDICT', summary: 'Deep retro complete' }],
  };
}

function makeAgentResult(output: unknown): AgentResult {
  return { output, decisionSummaries: [], events: [] };
}

function projectConfigWith(defaultTier: 'light' | 'deep') {
  return {
    agentConfig: {
      retrospectivePolicy: { defaultTier, deepTriggers: [] },
    },
  };
}

const SLUG = 'goose-hub-self';

beforeEach(() => {
  vi.clearAllMocks();
  mockRun.mockReset();
  mockReplay.mockReturnValue([]);
});

// ─── tests ────────────────────────────────────────────────────────────────────

// ─── computeTriggers detection ────────────────────────────────────────────────

describe('computeTriggers', () => {
  it('sets retriesGe2=true when 2+ agent.retry-escalated events exist for the work item', async () => {
    const retroItem = makeWorkItem({ state: 'factory:retrospecting' });
    const source = makeMockSource([retroItem]);
    mockGetProject.mockResolvedValue(projectConfigWith('light'));
    mockReplay.mockImplementation((filter: { workItemId?: string }) =>
      filter.workItemId
        ? [
            { id: 1, kind: 'agent.retry-escalated', payload: { attempt: 1 }, createdAt: '' },
            { id: 2, kind: 'agent.retry-escalated', payload: { attempt: 2 }, createdAt: '' },
          ]
        : [],
    );
    mockRun.mockResolvedValueOnce(makeAgentResult(makeDeepRetroOutput()));

    const { runRetroBatch } = await import('./retro-batch.js');
    await runRetroBatch(SLUG, source);

    const runtimeArgs = mockRun.mock.calls[0]?.[0] as { skill?: string };
    expect(runtimeArgs.skill).toBe('retrospective-deep');
  });

  it('does not set retriesGe2 when only 1 retry event exists', async () => {
    const retroItem = makeWorkItem({ state: 'factory:retrospecting' });
    const source = makeMockSource([retroItem]);
    mockGetProject.mockResolvedValue(projectConfigWith('light'));
    // project-scoped replay returns a prior retro so firstRunInMilestone=false
    mockReplay.mockImplementation((filter: { workItemId?: string }) =>
      filter.workItemId
        ? [{ id: 1, kind: 'agent.retry-escalated', payload: { attempt: 1 }, createdAt: '' }]
        : [{ id: 99, kind: 'retrospective.completed', payload: { tier: 'light' }, createdAt: '' }],
    );
    mockRun.mockResolvedValueOnce(makeAgentResult(makeLightRetroOutput()));

    const { runRetroBatch } = await import('./retro-batch.js');
    await runRetroBatch(SLUG, source);

    const runtimeArgs = mockRun.mock.calls[0]?.[0] as { skill?: string };
    expect(runtimeArgs.skill).toBe('retrospective-light');
  });

  it('sets budgetExceeded=true when project.budget-exceeded event exists', async () => {
    const retroItem = makeWorkItem({ state: 'factory:retrospecting' });
    const source = makeMockSource([retroItem]);
    mockGetProject.mockResolvedValue(projectConfigWith('light'));
    mockReplay.mockImplementation((filter: { workItemId?: string }) =>
      filter.workItemId
        ? []
        : [{ id: 1, kind: 'project.budget-exceeded', payload: {}, createdAt: '' }],
    );
    mockRun.mockResolvedValueOnce(makeAgentResult(makeDeepRetroOutput()));

    const { runRetroBatch } = await import('./retro-batch.js');
    await runRetroBatch(SLUG, source);

    const runtimeArgs = mockRun.mock.calls[0]?.[0] as { skill?: string };
    expect(runtimeArgs.skill).toBe('retrospective-deep');
  });

  it('sets priorityHigh=true for high-priority work items', async () => {
    const retroItem = makeWorkItem({ state: 'factory:retrospecting', priority: 'high' });
    const source = makeMockSource([retroItem]);
    mockGetProject.mockResolvedValue(projectConfigWith('light'));
    mockRun.mockResolvedValueOnce(makeAgentResult(makeDeepRetroOutput()));

    const { runRetroBatch } = await import('./retro-batch.js');
    await runRetroBatch(SLUG, source);

    const runtimeArgs = mockRun.mock.calls[0]?.[0] as { skill?: string };
    expect(runtimeArgs.skill).toBe('retrospective-deep');
  });

  it('sets priorityHigh=true for critical-priority work items', async () => {
    const retroItem = makeWorkItem({ state: 'factory:retrospecting', priority: 'critical' });
    const source = makeMockSource([retroItem]);
    mockGetProject.mockResolvedValue(projectConfigWith('light'));
    mockRun.mockResolvedValueOnce(makeAgentResult(makeDeepRetroOutput()));

    const { runRetroBatch } = await import('./retro-batch.js');
    await runRetroBatch(SLUG, source);

    const runtimeArgs = mockRun.mock.calls[0]?.[0] as { skill?: string };
    expect(runtimeArgs.skill).toBe('retrospective-deep');
  });

  it('sets humanRequested=true when gate.awaiting-human event exists for work item', async () => {
    const retroItem = makeWorkItem({ state: 'factory:retrospecting' });
    const source = makeMockSource([retroItem]);
    mockGetProject.mockResolvedValue(projectConfigWith('light'));
    mockReplay.mockImplementation((filter: { workItemId?: string }) =>
      filter.workItemId
        ? [
            {
              id: 1,
              kind: 'gate.awaiting-human',
              payload: { reason: 'manual review' },
              createdAt: '',
            },
          ]
        : [],
    );
    mockRun.mockResolvedValueOnce(makeAgentResult(makeDeepRetroOutput()));

    const { runRetroBatch } = await import('./retro-batch.js');
    await runRetroBatch(SLUG, source);

    const runtimeArgs = mockRun.mock.calls[0]?.[0] as { skill?: string };
    expect(runtimeArgs.skill).toBe('retrospective-deep');
  });

  it('sets firstRunInMilestone=true when no prior retrospective.completed events exist for project', async () => {
    const retroItem = makeWorkItem({ state: 'factory:retrospecting' });
    const source = makeMockSource([retroItem]);
    mockGetProject.mockResolvedValue(projectConfigWith('light'));
    // replay returns [] for both work-item and project-scoped calls → no prior retros
    mockReplay.mockReturnValue([]);
    mockRun.mockResolvedValueOnce(makeAgentResult(makeDeepRetroOutput()));

    const { runRetroBatch } = await import('./retro-batch.js');
    await runRetroBatch(SLUG, source);

    const runtimeArgs = mockRun.mock.calls[0]?.[0] as { skill?: string };
    expect(runtimeArgs.skill).toBe('retrospective-deep');
  });

  it('does not set firstRunInMilestone when prior retrospective.completed events exist', async () => {
    const retroItem = makeWorkItem({ state: 'factory:retrospecting' });
    const source = makeMockSource([retroItem]);
    mockGetProject.mockResolvedValue(projectConfigWith('light'));
    mockReplay.mockImplementation((filter: { workItemId?: string }) =>
      filter.workItemId
        ? []
        : [{ id: 1, kind: 'retrospective.completed', payload: { tier: 'light' }, createdAt: '' }],
    );
    mockRun.mockResolvedValueOnce(makeAgentResult(makeLightRetroOutput()));

    const { runRetroBatch } = await import('./retro-batch.js');
    await runRetroBatch(SLUG, source);

    const runtimeArgs = mockRun.mock.calls[0]?.[0] as { skill?: string };
    expect(runtimeArgs.skill).toBe('retrospective-light');
  });
});

describe('runRetroBatch', () => {
  it('processes only items in factory:retrospecting and runs the workflow', async () => {
    const retroItem = makeWorkItem({ state: 'factory:retrospecting' });
    const otherItem = makeWorkItem({
      id: 'github:shaunnez/goose-hub#43',
      externalId: '43',
      state: 'factory:needs-qa',
    });
    const source = makeMockSource([retroItem, otherItem]);
    mockGetProject.mockResolvedValue(projectConfigWith('light'));
    mockRun.mockResolvedValueOnce(makeAgentResult(makeLightRetroOutput()));

    const { runRetroBatch } = await import('./retro-batch.js');
    await runRetroBatch(SLUG, source);

    expect(mockRun).toHaveBeenCalledTimes(1);
    expect(source.transitionState).toHaveBeenCalledWith(
      '42',
      'factory:retrospecting',
      'factory:done',
    );
  });

  it('runs deep retro when QA failed for the work item', async () => {
    const retroItem = makeWorkItem({ state: 'factory:retrospecting' });
    const source = makeMockSource([retroItem]);
    mockGetProject.mockResolvedValue(projectConfigWith('light'));
    mockReplay.mockReturnValue([
      { id: 1, kind: 'qa.completed', payload: { verdict: 'fail' }, createdAt: '' },
    ]);
    mockRun.mockResolvedValueOnce(makeAgentResult(makeDeepRetroOutput()));

    const { runRetroBatch } = await import('./retro-batch.js');
    await runRetroBatch(SLUG, source);

    // tier=deep emitted via agent.run-started; assert by inspecting the runtime call
    const runtimeArgs = mockRun.mock.calls[0]?.[0] as { skill?: string };
    expect(runtimeArgs.skill).toBe('retrospective-deep');
  });

  it('runs light retro when defaultTier=light and no triggers fire', async () => {
    const retroItem = makeWorkItem({ state: 'factory:retrospecting' });
    const source = makeMockSource([retroItem]);
    mockGetProject.mockResolvedValue(projectConfigWith('light'));
    // simulate a project that has already run retros so firstRunInMilestone=false
    mockReplay.mockImplementation((filter: { workItemId?: string }) =>
      filter.workItemId
        ? []
        : [{ id: 99, kind: 'retrospective.completed', payload: { tier: 'light' }, createdAt: '' }],
    );
    mockRun.mockResolvedValueOnce(makeAgentResult(makeLightRetroOutput()));

    const { runRetroBatch } = await import('./retro-batch.js');
    await runRetroBatch(SLUG, source);

    const runtimeArgs = mockRun.mock.calls[0]?.[0] as { skill?: string };
    expect(runtimeArgs.skill).toBe('retrospective-light');
  });

  it('forces deep retro when defaultTier=deep regardless of triggers', async () => {
    const retroItem = makeWorkItem({ state: 'factory:retrospecting' });
    const source = makeMockSource([retroItem]);
    mockGetProject.mockResolvedValue(projectConfigWith('deep'));
    mockRun.mockResolvedValueOnce(makeAgentResult(makeDeepRetroOutput()));

    const { runRetroBatch } = await import('./retro-batch.js');
    await runRetroBatch(SLUG, source);

    const runtimeArgs = mockRun.mock.calls[0]?.[0] as { skill?: string };
    expect(runtimeArgs.skill).toBe('retrospective-deep');
  });

  it('transitions to factory:needs-human if the workflow throws', async () => {
    const retroItem = makeWorkItem({ state: 'factory:retrospecting' });
    const source = makeMockSource([retroItem]);
    mockGetProject.mockResolvedValue(projectConfigWith('light'));
    mockRun.mockRejectedValueOnce(new Error('runtime exploded'));

    const { runRetroBatch } = await import('./retro-batch.js');
    await runRetroBatch(SLUG, source);

    expect(source.transitionState).toHaveBeenCalledWith(
      '42',
      'factory:retrospecting',
      'factory:needs-human',
    );
  });
});
