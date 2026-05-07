import type { AgentResult } from '@goose-hub/core/agent-runtime/interface.js';
import type { StateSource, WorkItem } from '@goose-hub/core/state-source/interface.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ─── sprint-review auto-trigger mock ──────────────────────────────────────────

const mockRunSprintReviewWorkflow = vi.fn();
vi.mock('@goose-hub/core/workflows/sprint-review.js', () => ({
  runSprintReviewWorkflow: mockRunSprintReviewWorkflow,
}));

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
    getPrDiff: vi.fn().mockResolvedValue(''),
    addLabels: vi.fn(),
    removeLabel: vi.fn(),
    listLabels: vi.fn().mockResolvedValue([]),
    watchForUpdates: vi.fn(),
  };
}

function makeLightRetroOutput() {
  return {
    outcome: 'success',
    workItemNumber: 42,
    summary: {
      wentWell: 'All went well.',
      didNotGoWell: 'Nothing material.',
      architecturalTakeaway: 'Keep current shape.',
    },
    improvementCandidates: [],
    decisionSummaries: [{ kind: 'VERDICT', summary: 'Light retro complete' }],
  };
}

function makeDeepRetroOutput() {
  return {
    outcome: 'partial',
    workItemNumber: 42,
    summary: {
      wentWell: 'Recovered after retry.',
      didNotGoWell: 'QA failed on edge case.',
      architecturalTakeaway: 'Strengthen QA edge-case coverage.',
    },
    triggerReasons: ['qa-failed'],
    personaQualityScores: [],
    learningEntries: [],
    decisionPatterns: [],
    improvementCandidates: [
      {
        kind: 'persona',
        targetPath: 'skills/qa/prompt.md',
        suggestionText: 'Add empty-input check to QA prompt',
        confidence: 'medium',
      },
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

  it('does not set retriesGe2 for stage=model retries (haiku→sonnet escalation)', async () => {
    const retroItem = makeWorkItem({ state: 'factory:retrospecting' });
    const source = makeMockSource([retroItem]);
    mockGetProject.mockResolvedValue(projectConfigWith('light'));
    // Two model-tier escalations on the same work item — must NOT trigger deep retro
    mockReplay.mockImplementation((filter: { workItemId?: string }) =>
      filter.workItemId
        ? [
            {
              id: 1,
              kind: 'agent.retry-escalated',
              payload: { stage: 'model', skill: 'implement', reason: 'schema-validation-failed' },
              createdAt: '',
            },
            {
              id: 2,
              kind: 'agent.retry-escalated',
              payload: { stage: 'model', skill: 'implement', reason: 'schema-validation-failed' },
              createdAt: '',
            },
          ]
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
    // simulate a prior retro so firstRunInMilestone=false → light tier
    mockReplay.mockImplementation((filter: { workItemId?: string }) =>
      filter.workItemId
        ? []
        : [{ id: 99, kind: 'retrospective.completed', payload: { tier: 'light' }, createdAt: '' }],
    );
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

// ─── sprint-review auto-trigger ───────────────────────────────────────────────

describe('sprint-review auto-trigger', () => {
  function makeRetroItem(overrides: Partial<WorkItem> = {}): WorkItem {
    return makeWorkItem({
      state: 'factory:retrospecting',
      schedule: 'current',
      milestoneId: '13',
      milestoneTitle: 'M13: Subagents',
      ...overrides,
    });
  }

  function makeSourceWithMilestoneItems(
    retroItems: WorkItem[],
    allMilestoneItems: WorkItem[],
  ): StateSource {
    const source = makeMockSource(retroItems);
    (source.listWorkByMilestone as ReturnType<typeof vi.fn>).mockResolvedValue(allMilestoneItems);
    return source;
  }

  beforeEach(() => {
    mockRunSprintReviewWorkflow.mockReset();
    mockRunSprintReviewWorkflow.mockResolvedValue({ issueNumber: 200 });
  });

  it('triggers sprint-review when the last schedule:current item completes retro', async () => {
    const retroItem = makeRetroItem();
    // After retro, this item transitions to factory:done. listWorkByMilestone returns it as done.
    const doneItem = { ...retroItem, state: 'factory:done' as const };
    const source = makeSourceWithMilestoneItems([retroItem], [doneItem]);
    mockGetProject.mockResolvedValue(projectConfigWith('light'));
    mockReplay.mockImplementation((filter: { workItemId?: string }) =>
      filter.workItemId
        ? []
        : [{ id: 99, kind: 'retrospective.completed', payload: { tier: 'light' }, createdAt: '' }],
    );
    mockRun.mockResolvedValueOnce(makeAgentResult(makeLightRetroOutput()));

    const { runRetroBatch } = await import('./retro-batch.js');
    await runRetroBatch(SLUG, source);

    // Give the fire-and-forget promise a chance to resolve
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(mockRunSprintReviewWorkflow).toHaveBeenCalledTimes(1);
    expect(mockRunSprintReviewWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: SLUG,
        milestoneTitle: 'M13: Subagents',
        milestoneNumber: 13,
      }),
    );
  });

  it('does NOT trigger sprint-review when other schedule:current items remain open', async () => {
    const retroItem = makeRetroItem({ externalId: '42' });
    const doneItem = { ...retroItem, state: 'factory:done' as const };
    // Another open schedule:current item still exists
    const pendingItem = makeWorkItem({
      externalId: '43',
      state: 'factory:needs-qa',
      schedule: 'current',
      milestoneId: '13',
      milestoneTitle: 'M13: Subagents',
    });
    const source = makeSourceWithMilestoneItems([retroItem], [doneItem, pendingItem]);
    mockGetProject.mockResolvedValue(projectConfigWith('light'));
    mockReplay.mockImplementation((filter: { workItemId?: string }) =>
      filter.workItemId
        ? []
        : [{ id: 99, kind: 'retrospective.completed', payload: { tier: 'light' }, createdAt: '' }],
    );
    mockRun.mockResolvedValueOnce(makeAgentResult(makeLightRetroOutput()));

    const { runRetroBatch } = await import('./retro-batch.js');
    await runRetroBatch(SLUG, source);

    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(mockRunSprintReviewWorkflow).not.toHaveBeenCalled();
  });

  it('does NOT trigger sprint-review when a sprint-review issue already exists (dedup)', async () => {
    const retroItem = makeRetroItem();
    const doneItem = { ...retroItem, state: 'factory:done' as const };
    // A sprint-review issue already exists
    const existingReview = makeWorkItem({
      externalId: '200',
      title: 'Sprint Review: M13: Subagents',
      state: 'factory:done',
    });
    const source = makeSourceWithMilestoneItems([retroItem], [doneItem, existingReview]);
    mockGetProject.mockResolvedValue(projectConfigWith('light'));
    mockReplay.mockImplementation((filter: { workItemId?: string }) =>
      filter.workItemId
        ? []
        : [{ id: 99, kind: 'retrospective.completed', payload: { tier: 'light' }, createdAt: '' }],
    );
    mockRun.mockResolvedValueOnce(makeAgentResult(makeLightRetroOutput()));

    const { runRetroBatch } = await import('./retro-batch.js');
    await runRetroBatch(SLUG, source);

    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(mockRunSprintReviewWorkflow).not.toHaveBeenCalled();
  });

  it('does NOT trigger sprint-review when item has no milestoneId', async () => {
    const retroItem = makeRetroItem({ milestoneId: undefined, milestoneTitle: undefined });
    const doneItem = { ...retroItem, state: 'factory:done' as const };
    const source = makeSourceWithMilestoneItems([retroItem], [doneItem]);
    mockGetProject.mockResolvedValue(projectConfigWith('light'));
    mockReplay.mockImplementation((filter: { workItemId?: string }) =>
      filter.workItemId
        ? []
        : [{ id: 99, kind: 'retrospective.completed', payload: { tier: 'light' }, createdAt: '' }],
    );
    mockRun.mockResolvedValueOnce(makeAgentResult(makeLightRetroOutput()));

    const { runRetroBatch } = await import('./retro-batch.js');
    await runRetroBatch(SLUG, source);

    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(mockRunSprintReviewWorkflow).not.toHaveBeenCalled();
  });

  it('logs error but does not throw when sprint-review workflow fails', async () => {
    const retroItem = makeRetroItem();
    const doneItem = { ...retroItem, state: 'factory:done' as const };
    const source = makeSourceWithMilestoneItems([retroItem], [doneItem]);
    mockGetProject.mockResolvedValue(projectConfigWith('light'));
    mockReplay.mockImplementation((filter: { workItemId?: string }) =>
      filter.workItemId
        ? []
        : [{ id: 99, kind: 'retrospective.completed', payload: { tier: 'light' }, createdAt: '' }],
    );
    mockRun.mockResolvedValueOnce(makeAgentResult(makeLightRetroOutput()));
    mockRunSprintReviewWorkflow.mockRejectedValueOnce(new Error('sprint-review exploded'));

    const { runRetroBatch } = await import('./retro-batch.js');
    // Should not throw
    await expect(runRetroBatch(SLUG, source)).resolves.not.toThrow();

    await new Promise((resolve) => setTimeout(resolve, 10));
  });
});
