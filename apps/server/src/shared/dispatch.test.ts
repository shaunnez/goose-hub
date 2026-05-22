import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * dispatch.ts dispatches to workflow modules via dynamic import. We use top-level
 * vi.mock() (hoisted) to intercept those dynamic imports at the module registry
 * level, then configure the mock functions per test using beforeEach.
 */

// ─── module-level mock stubs ───────────────────────────────────────────────

const mockRunTriageBatch = vi.fn();
const mockRunInvestigateWorkflow = vi.fn();
const mockRunAcceptanceContractWorkflow = vi.fn();
const mockRunQaWorkflow = vi.fn();
const mockGetSourceForSlug = vi.fn();
const mockGetProject = vi.fn();
const mockLoggerError = vi.fn();
const mockLoggerInfo = vi.fn();
const mockLoggerWarn = vi.fn();

const mockRunRetroForItem = vi.fn();
const mockFilterEligibleByDependencies = vi.fn();
const mockCreateProjectAwareTargetSource = vi.fn();
const mockRunGrillAndPrdWorkflow = vi.fn();
const mockRunDecomposePrdWorkflow = vi.fn();
const mockGetUseMultiAgentPipeline = vi.fn();
const mockGetEngineeringSpec = vi.fn();
const mockRunParallelImplementWorkflow = vi.fn();
const mockEventStoreReplay = vi.fn();
const mockEventStoreAppendEvent = vi.fn();

vi.mock('@goose-hub/core/db/repositories/project-settings.js', () => ({
  readProjectSettings: vi.fn().mockReturnValue(null),
  readProjectSkillSettings: vi.fn().mockReturnValue(new Map()),
  getUseMultiAgentPipeline: mockGetUseMultiAgentPipeline,
  setUseMultiAgentPipeline: vi.fn(),
  deriveUseMultiAgentPipeline: vi.fn().mockReturnValue(false),
}));

vi.mock('@goose-hub/core/engineering-specs/repository.js', () => ({
  getEngineeringSpec: mockGetEngineeringSpec,
}));

vi.mock('../../../../slices/parallel-implement/workflow.js', () => ({
  runParallelImplementWorkflow: mockRunParallelImplementWorkflow,
}));

vi.mock('@goose-hub/core/projects/dependency-scheduler.js', () => ({
  filterEligibleByDependencies: mockFilterEligibleByDependencies,
}));

vi.mock('@goose-hub/core/state-source/dependency-resolver.js', () => ({
  createProjectAwareTargetSource: mockCreateProjectAwareTargetSource,
}));

vi.mock('../domains/workflows/triage-batch.js', () => ({
  runTriageBatch: mockRunTriageBatch,
}));

vi.mock('../../../../slices/investigate/workflow.js', () => ({
  runInvestigateWorkflow: mockRunInvestigateWorkflow,
}));

vi.mock('../../../../slices/acceptance-contract/workflow.js', () => ({
  runAcceptanceContractWorkflow: mockRunAcceptanceContractWorkflow,
}));

vi.mock('../../../../slices/qa/workflow.js', () => ({
  runQaWorkflow: mockRunQaWorkflow,
}));

vi.mock('../domains/workflows/retro-batch.js', () => ({
  runRetroForItem: mockRunRetroForItem,
  runRetroBatch: vi.fn(),
}));

vi.mock('./source.js', () => ({
  getSourceForSlug: mockGetSourceForSlug,
  isValidSlug: vi.fn().mockReturnValue(true),
}));

vi.mock('./projects.js', () => ({
  getProject: mockGetProject,
}));

vi.mock('@goose-hub/core/logger.js', () => ({
  logger: {
    error: mockLoggerError,
    info: mockLoggerInfo,
    warn: mockLoggerWarn,
    debug: vi.fn(),
  },
}));

vi.mock('@goose-hub/core/workflows/grill-and-prd.js', () => ({
  runGrillAndPrdWorkflow: mockRunGrillAndPrdWorkflow,
}));

vi.mock('@goose-hub/core/workflows/decompose-prd.js', () => ({
  runDecomposePrdWorkflow: mockRunDecomposePrdWorkflow,
}));

vi.mock('@goose-hub/core/event-stream/store.js', () => ({
  eventStore: {
    replay: mockEventStoreReplay,
    appendEvent: mockEventStoreAppendEvent,
    subscribe: vi.fn().mockReturnValue(() => {}),
  },
}));

// ─── helpers ──────────────────────────────────────────────────────────────

const originalMockSource = process.env.MOCK_SOURCE;

beforeEach(() => {
  vi.resetModules(); // reset module-level in-flight Sets between tests
  vi.resetAllMocks(); // clears call counts AND implementation queues (once-mocks)
  if (originalMockSource == null) {
    process.env.MOCK_SOURCE = undefined;
  } else {
    process.env.MOCK_SOURCE = originalMockSource;
  }
  mockRunTriageBatch.mockResolvedValue(undefined);
  mockRunInvestigateWorkflow.mockResolvedValue(undefined);
  mockRunAcceptanceContractWorkflow.mockResolvedValue(undefined);
  mockRunQaWorkflow.mockResolvedValue(undefined);
  mockRunRetroForItem.mockResolvedValue(undefined);
  mockRunGrillAndPrdWorkflow.mockResolvedValue(undefined);
  mockRunDecomposePrdWorkflow.mockResolvedValue(undefined);
  mockRunParallelImplementWorkflow.mockResolvedValue({ status: 'success' });
  mockGetSourceForSlug.mockResolvedValue(null);
  // Default: single-workflow-per-project (backward-compat) for tests that don't override.
  mockGetProject.mockResolvedValue(null);
  mockGetUseMultiAgentPipeline.mockReturnValue(false);
  mockGetEngineeringSpec.mockReturnValue(null);
  mockEventStoreReplay.mockReturnValue([]);
  mockEventStoreAppendEvent.mockReturnValue({
    id: 1,
    projectId: '',
    workItemId: null,
    kind: 'agent.run-failed',
    payload: {},
    createdAt: '',
  });
  mockCreateProjectAwareTargetSource.mockResolvedValue(vi.fn());
  mockFilterEligibleByDependencies.mockResolvedValue({
    eligible: [],
    blocked: [],
    unregistered: [],
  });
});

// ─── dispatchTriageBatch ──────────────────────────────────────────────────

describe('dispatchTriageBatch', () => {
  it('calls runTriageBatch with the slug', async () => {
    const { dispatchTriageBatch } = await import('./dispatch.js');
    await dispatchTriageBatch('my-project');

    expect(mockRunTriageBatch).toHaveBeenCalledOnce();
    expect(mockRunTriageBatch).toHaveBeenCalledWith('my-project');
  });

  it('swallows errors and does not throw (best-effort behaviour)', async () => {
    mockRunTriageBatch.mockRejectedValue(new Error('triage failed'));

    const { dispatchTriageBatch } = await import('./dispatch.js');
    // Must NOT throw
    await expect(dispatchTriageBatch('my-project')).resolves.toBeUndefined();
  });

  it('logs the error when runTriageBatch throws', async () => {
    mockRunTriageBatch.mockRejectedValue(new Error('kaboom'));

    const { dispatchTriageBatch } = await import('./dispatch.js');
    await dispatchTriageBatch('err-slug');

    expect(mockLoggerError).toHaveBeenCalledOnce();
    expect(mockLoggerError.mock.calls[0][0]).toContain('dispatchTriageBatch failed');
  });

  it('concurrent calls same slug: second coalesces into one deferred run', async () => {
    let resolveRun: (() => void) | undefined;
    mockRunTriageBatch
      .mockImplementationOnce(
        () =>
          new Promise<void>((r) => {
            resolveRun = r;
          }),
      )
      .mockResolvedValue(undefined);

    const { dispatchTriageBatch } = await import('./dispatch.js');

    // Fire all three concurrently — p2/p3 return immediately (coalesced to pending)
    const [p1, p2, p3] = [
      dispatchTriageBatch('slug'),
      dispatchTriageBatch('slug'),
      dispatchTriageBatch('slug'),
    ];
    await Promise.all([p2, p3]);

    // Wait until the dynamic import resolves and runTriageBatch is actually in-flight
    await vi.waitFor(() => {
      expect(resolveRun).toBeDefined();
    });
    expect(mockRunTriageBatch).toHaveBeenCalledTimes(1);

    resolveRun?.();
    await p1;

    // Wait for the single deferred run to complete (avoids leaked async work)
    await vi.waitFor(() => {
      expect(mockRunTriageBatch).toHaveBeenCalledTimes(2);
    });
  });

  it('different slugs do not block each other', async () => {
    const { dispatchTriageBatch } = await import('./dispatch.js');
    // Sequential is sufficient: if in-flight check for slug-a blocked slug-b,
    // slug-b would skip runTriageBatch. Sequential also avoids Vitest concurrent-
    // mock-cache timing issues with the same dynamic import path.
    await dispatchTriageBatch('slug-a');
    await dispatchTriageBatch('slug-b');

    expect(mockRunTriageBatch).toHaveBeenCalledTimes(2);
    expect(mockRunTriageBatch).toHaveBeenNthCalledWith(1, 'slug-a');
    expect(mockRunTriageBatch).toHaveBeenNthCalledWith(2, 'slug-b');
  });
});

// ─── dispatchInvestigate ──────────────────────────────────────────────────

describe('dispatchInvestigate', () => {
  it('returns early and logs when source is null', { timeout: 30_000 }, async () => {
    mockGetSourceForSlug.mockResolvedValue(null);

    const { dispatchInvestigate } = await import('./dispatch.js');
    await expect(dispatchInvestigate('no-source', 42)).resolves.toBeUndefined();
    expect(mockLoggerError).toHaveBeenCalledWith(
      'dispatchInvestigate: no source for slug',
      expect.objectContaining({ slug: 'no-source' }),
    );
  });

  it('drops duplicate trigger for same issue while in-flight', async () => {
    let resolveSource!: () => void;
    mockGetSourceForSlug.mockReturnValueOnce(
      new Promise<null>((r) => {
        resolveSource = () => r(null);
      }),
    );

    const { dispatchInvestigate } = await import('./dispatch.js');
    const p1 = dispatchInvestigate('slug', 5);
    const p2 = dispatchInvestigate('slug', 5); // duplicate — should be dropped

    await p2;
    expect(mockLoggerWarn).toHaveBeenCalledWith(
      'dispatchInvestigate: duplicate in-flight, dropping',
      expect.objectContaining({ slug: 'slug', issueNumber: 5 }),
    );

    resolveSource();
    await p1;
    expect(mockGetSourceForSlug).toHaveBeenCalledTimes(1);
  });

  it('different issue numbers run independently when maxParallelAgents allows it', async () => {
    // Set maxParallelAgents=2 so both can run concurrently (M11 parallel dispatch).
    mockGetProject.mockResolvedValue({ budgets: { maxParallelAgents: 2 } });

    const { dispatchInvestigate } = await import('./dispatch.js');
    await Promise.all([dispatchInvestigate('slug', 1), dispatchInvestigate('slug', 2)]);
    expect(mockGetSourceForSlug).toHaveBeenCalledTimes(2);
    expect(mockLoggerWarn).not.toHaveBeenCalled();
  });

  it('keeps a post-lock investigation-complete fallback when production webhook dispatch is dropped', async () => {
    const item = {
      id: 'github:shaunnez/goose-hub#42',
      externalId: '42',
      state: 'factory:investigation-complete',
    };
    const source = {
      repoRef: 'shaunnez/goose-hub',
      getItem: vi.fn().mockResolvedValue(item),
      transitionState: vi.fn().mockResolvedValue(undefined),
    };
    mockGetSourceForSlug.mockResolvedValue(source);
    mockEventStoreReplay.mockReturnValue([
      {
        kind: 'agent.investigation-complete',
        payload: { investigate: { confidence: 'high' } },
      },
    ]);

    const { dispatchInvestigate, dispatchInvestigationComplete } = await import('./dispatch.js');
    mockRunInvestigateWorkflow.mockImplementationOnce(async () => {
      await dispatchInvestigationComplete('goose-hub-self', 42);
    });

    await dispatchInvestigate('goose-hub-self', 42);

    expect(mockRunInvestigateWorkflow).toHaveBeenCalledOnce();
    expect(mockLoggerWarn).toHaveBeenCalledWith(
      'dispatchInvestigationComplete: duplicate in-flight, dropping',
      expect.objectContaining({ slug: 'goose-hub-self', issueNumber: 42 }),
    );
    expect(source.transitionState).toHaveBeenCalledWith(
      'github:shaunnez/goose-hub#42',
      'factory:investigation-complete',
      'factory:dev-ready',
    );
    expect(mockEventStoreAppendEvent).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'state.transitioned' }),
    );
  });

  it('chains investigation-complete routing in MOCK_SOURCE mode', async () => {
    process.env.MOCK_SOURCE = 'true';
    const item = {
      id: 'github:shaunnez/goose-hub#42',
      externalId: '42',
      state: 'factory:investigation-complete',
    };
    const source = {
      repoRef: 'shaunnez/goose-hub',
      getItem: vi.fn().mockResolvedValue(item),
      transitionState: vi.fn().mockResolvedValue(undefined),
    };
    mockGetSourceForSlug.mockResolvedValue(source);
    mockEventStoreReplay.mockReturnValue([
      {
        kind: 'agent.investigation-complete',
        payload: { investigate: { confidence: 'high' } },
      },
    ]);

    const { dispatchInvestigate } = await import('./dispatch.js');
    await dispatchInvestigate('goose-hub-self', 42);

    expect(source.transitionState).toHaveBeenCalledWith(
      'github:shaunnez/goose-hub#42',
      'factory:investigation-complete',
      'factory:dev-ready',
    );
    expect(mockEventStoreAppendEvent).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'state.transitioned' }),
    );
  });
});

// ─── dispatchInvestigationComplete ───────────────────────────────────────

describe('dispatchInvestigationComplete', () => {
  function investigationCompleteSource() {
    return {
      repoRef: 'shaunnez/goose-hub',
      getItem: vi.fn().mockResolvedValue({
        id: 'github:shaunnez/goose-hub#42',
        externalId: '42',
        state: 'factory:investigation-complete',
      }),
      comment: vi.fn().mockResolvedValue(undefined),
      transitionState: vi.fn().mockResolvedValue(undefined),
    };
  }

  it('suppresses duplicate equivalent investigation-complete to dev-ready events', async () => {
    const source = investigationCompleteSource();
    mockGetSourceForSlug.mockResolvedValue(source);
    mockEventStoreReplay.mockReturnValue([
      {
        kind: 'agent.investigation-complete',
        payload: { investigate: { confidence: 'high' } },
      },
      {
        kind: 'state.transitioned',
        payload: {
          from: 'factory:investigation-complete',
          to: 'factory:dev-ready',
          by: 'orchestrator',
        },
      },
    ]);

    const { dispatchInvestigationComplete } = await import('./dispatch.js');
    await dispatchInvestigationComplete('goose-hub-self', 42);

    expect(source.transitionState).not.toHaveBeenCalled();
    expect(mockEventStoreAppendEvent).not.toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'state.transitioned' }),
    );
  });

  it('does not treat a prior investigation cycle transition as a duplicate', async () => {
    const source = investigationCompleteSource();
    mockGetSourceForSlug.mockResolvedValue(source);
    mockEventStoreReplay.mockReturnValue([
      {
        kind: 'agent.investigation-complete',
        payload: { investigate: { confidence: 'high' } },
      },
      {
        kind: 'state.transitioned',
        payload: {
          from: 'factory:investigation-complete',
          to: 'factory:dev-ready',
          by: 'orchestrator',
        },
      },
      {
        kind: 'state.transitioned',
        payload: {
          from: 'factory:dev-ready',
          to: 'factory:investigating',
          by: 'resume',
        },
      },
      {
        kind: 'agent.investigation-complete',
        payload: { investigate: { confidence: 'high' } },
      },
    ]);

    const { dispatchInvestigationComplete } = await import('./dispatch.js');
    await dispatchInvestigationComplete('goose-hub-self', 42);

    expect(source.transitionState).toHaveBeenCalledWith(
      'github:shaunnez/goose-hub#42',
      'factory:investigation-complete',
      'factory:dev-ready',
    );
    expect(mockEventStoreAppendEvent).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'state.transitioned' }),
    );
  });

  it('coalesces near-simultaneous investigation-complete dispatches to one transition event', async () => {
    let releaseTransition!: () => void;
    const source = investigationCompleteSource();
    source.transitionState.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          releaseTransition = resolve;
        }),
    );
    mockGetSourceForSlug.mockResolvedValue(source);
    mockEventStoreReplay.mockReturnValue([
      {
        kind: 'agent.investigation-complete',
        payload: { investigate: { confidence: 'high' } },
      },
    ]);

    const { dispatchInvestigationComplete } = await import('./dispatch.js');
    const first = dispatchInvestigationComplete('goose-hub-self', 42);
    await vi.waitFor(() => {
      expect(source.transitionState).toHaveBeenCalledTimes(1);
    });
    const second = dispatchInvestigationComplete('goose-hub-self', 42);
    await second;
    releaseTransition();
    await first;

    const stateEvents = mockEventStoreAppendEvent.mock.calls.filter(
      ([event]) => event.kind === 'state.transitioned',
    );
    expect(stateEvents).toHaveLength(1);
  });

  it('attaches acceptance-contract run metadata to validation failure events', async () => {
    const source = investigationCompleteSource();
    mockGetSourceForSlug.mockResolvedValue(source);
    mockEventStoreReplay.mockReturnValue([
      {
        kind: 'agent.investigation-complete',
        payload: { investigate: { confidence: 'high' } },
      },
    ]);
    const error = new Error('Acceptance contract output validation failed');
    Object.assign(error, {
      runId: 'contract-run-1',
      personaId: 'goose/developer/0',
    });
    mockRunAcceptanceContractWorkflow.mockRejectedValue(error);

    const { dispatchInvestigationComplete } = await import('./dispatch.js');
    await dispatchInvestigationComplete('goose-hub-self', 42);

    expect(mockEventStoreAppendEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'agent.run-failed',
        runId: 'contract-run-1',
        personaId: 'goose/developer/0',
        payload: expect.objectContaining({ skill: 'acceptance-contract' }),
      }),
    );
    expect(source.transitionState).toHaveBeenCalledWith(
      'github:shaunnez/goose-hub#42',
      'factory:investigation-complete',
      'factory:gate-pending',
    );
  });
});

// ─── dispatchFixIssue ─────────────────────────────────────────────────────

describe('dispatchFixIssue', () => {
  it('reads useMultiAgentPipeline flag and logs at entry', { timeout: 30_000 }, async () => {
    mockGetSourceForSlug.mockResolvedValue(null);

    const { dispatchFixIssue } = await import('./dispatch.js');
    await dispatchFixIssue('no-source', 10);
    expect(mockLoggerInfo).toHaveBeenCalledWith(
      'dispatchFixIssue: pipeline flag',
      expect.objectContaining({
        slug: 'no-source',
        issueNumber: 10,
        useMultiAgentPipeline: false,
      }),
    );
  });

  it('returns early and logs when source is null', { timeout: 30_000 }, async () => {
    mockGetSourceForSlug.mockResolvedValue(null);

    const { dispatchFixIssue } = await import('./dispatch.js');
    await expect(dispatchFixIssue('no-source', 10)).resolves.toBeUndefined();
    expect(mockLoggerError).toHaveBeenCalledWith(
      'dispatchFixIssue: no source for slug',
      expect.objectContaining({ slug: 'no-source' }),
    );
  });

  it('drops duplicate trigger for same issue while in-flight', async () => {
    let resolveSource!: () => void;
    mockGetSourceForSlug.mockReturnValueOnce(
      new Promise<null>((r) => {
        resolveSource = () => r(null);
      }),
    );

    const { dispatchFixIssue } = await import('./dispatch.js');
    const p1 = dispatchFixIssue('slug', 7);
    const p2 = dispatchFixIssue('slug', 7);

    await p2;
    expect(mockLoggerWarn).toHaveBeenCalledWith(
      'dispatchFixIssue: duplicate in-flight, dropping',
      expect.objectContaining({ slug: 'slug', issueNumber: 7 }),
    );

    resolveSource();
    await p1;
    expect(mockGetSourceForSlug).toHaveBeenCalledTimes(1);
  });

  it('skips workflow and logs when item is dep-blocked', { timeout: 30_000 }, async () => {
    const mockItem = {
      id: 'item-1',
      externalId: '42',
      title: 'blocked issue',
      body: 'Depends on #99',
      state: 'factory:dev-ready',
      schedule: 'current',
      type: 'feature',
    };
    const mockSource = {
      getItem: vi.fn().mockResolvedValue(mockItem),
      setLabelInGroup: vi.fn().mockResolvedValue(undefined),
      comment: vi.fn().mockResolvedValue(undefined),
    };
    mockGetSourceForSlug.mockResolvedValue(mockSource);
    mockGetProject.mockResolvedValue({
      budgets: { maxParallelAgents: 1 },
      source: { repo: 'shaunnez/goose-hub', type: 'github' },
    });
    mockFilterEligibleByDependencies.mockResolvedValue({
      eligible: [],
      blocked: [mockItem],
      unregistered: [],
    });

    const { dispatchFixIssue } = await import('./dispatch.js');
    await expect(dispatchFixIssue('slug', 42)).resolves.toBeUndefined();

    expect(mockFilterEligibleByDependencies).toHaveBeenCalledWith(
      [mockItem],
      expect.objectContaining({ currentRepo: 'shaunnez/goose-hub' }),
    );
    expect(mockLoggerInfo).toHaveBeenCalledWith(
      'dispatchFixIssue: item blocked by deps, skipping',
      expect.objectContaining({ slug: 'slug', issueNumber: 42 }),
    );
  });

  it('runs workflow when item has no unmet deps (eligible)', { timeout: 30_000 }, async () => {
    const mockItem = {
      id: 'item-2',
      externalId: '43',
      title: 'clear issue',
      body: 'No deps',
      state: 'factory:dev-ready',
      schedule: 'current',
      type: 'feature',
    };
    const mockSource = {
      getItem: vi.fn().mockResolvedValue(mockItem),
      setLabelInGroup: vi.fn().mockResolvedValue(undefined),
      comment: vi.fn().mockResolvedValue(undefined),
    };
    mockGetSourceForSlug.mockResolvedValue(mockSource);
    mockGetProject.mockResolvedValue({
      budgets: { maxParallelAgents: 1 },
      source: { repo: 'shaunnez/goose-hub', type: 'github' },
    });
    mockFilterEligibleByDependencies.mockResolvedValue({
      eligible: [mockItem],
      blocked: [],
      unregistered: [],
    });

    const { dispatchFixIssue } = await import('./dispatch.js');
    // Dynamic import of slices/fix-issue may fail in test env — that's fine.
    // What matters: filterEligibleByDependencies was called AND blocked message was NOT logged.
    await dispatchFixIssue('slug', 43).catch(() => {
      // acceptable: dynamic import may fail in test env
    });

    expect(mockFilterEligibleByDependencies).toHaveBeenCalledWith(
      [mockItem],
      expect.objectContaining({ currentRepo: 'shaunnez/goose-hub' }),
    );
    expect(mockLoggerInfo).not.toHaveBeenCalledWith(
      'dispatchFixIssue: item blocked by deps, skipping',
      expect.anything(),
    );
  });
});

// ─── dispatchFixIssue: bug routing (M19 pipeline vs legacy) ──────────────────

describe('dispatchFixIssue: bug routing', () => {
  const makeSource = (item: Record<string, unknown>) => ({
    getItem: vi.fn().mockResolvedValue(item),
    setLabelInGroup: vi.fn().mockResolvedValue(undefined),
    comment: vi.fn().mockResolvedValue(undefined),
    transitionState: vi.fn().mockResolvedValue(undefined),
    listLabels: vi.fn().mockResolvedValue([]),
  });

  const simpleInvEvent = {
    id: 1,
    projectId: 'slug',
    workItemId: 'item-bug',
    kind: 'agent.investigation-complete',
    payload: {
      investigate: {
        findings: 'root cause found',
        keyFiles: [{ path: 'src/foo.ts', reason: 'logo text here' }],
        confidence: 'high',
        openQuestions: ['Wave-2 scouts errored — scope fully contained, non-blocking'],
        requiresBrowserRepro: false,
        decisionSummaries: [{ kind: 'READ', summary: 'found it' }],
      },
      investigationRunId: 'run-abc',
    },
    createdAt: new Date().toISOString(),
  };

  const complexInvEvent = {
    ...simpleInvEvent,
    payload: {
      investigate: {
        ...simpleInvEvent.payload.investigate,
        keyFiles: [
          { path: 'src/a.ts', reason: 'a' },
          { path: 'src/b.ts', reason: 'b' },
          { path: 'src/c.ts', reason: 'c' },
          { path: 'src/d.ts', reason: 'd' },
        ],
        confidence: 'high',
        openQuestions: ['Is the schema affected?'],
      },
      investigationRunId: 'run-def',
    },
  };

  it('routes simple bug (≤3 non-test files, high confidence) to legacy path', async () => {
    mockGetUseMultiAgentPipeline.mockReturnValue(true);
    mockGetProject.mockResolvedValue({ id: 'slug', budgets: { maxParallelAgents: 1 } });
    const bugItem = {
      id: 'item-bug',
      externalId: '99',
      title: 'logo wrong',
      body: '',
      state: 'factory:dev-ready',
      schedule: 'current',
      type: 'bug',
    };
    mockGetSourceForSlug.mockResolvedValue(makeSource(bugItem));
    mockEventStoreReplay.mockReturnValue([simpleInvEvent]);

    const { dispatchFixIssue } = await import('./dispatch.js');
    await dispatchFixIssue('slug', 99).catch(() => {
      /* legacy dynamic import may fail in test env */
    });

    expect(mockLoggerInfo).toHaveBeenCalledWith(
      'dispatchFixIssue: simple bug → legacy single-agent path',
      expect.objectContaining({ slug: 'slug', issueNumber: 99 }),
    );
  });

  it('excludes test files from complexity count (source + test → legacy)', async () => {
    mockGetUseMultiAgentPipeline.mockReturnValue(true);
    mockGetProject.mockResolvedValue({ id: 'slug', budgets: { maxParallelAgents: 1 } });
    const bugItem = {
      id: 'item-bug',
      externalId: '99',
      title: 'logo wrong',
      body: '',
      state: 'factory:dev-ready',
      schedule: 'current',
      type: 'bug',
    };
    mockGetSourceForSlug.mockResolvedValue(makeSource(bugItem));
    mockEventStoreReplay.mockReturnValue([
      {
        ...simpleInvEvent,
        payload: {
          investigate: {
            ...simpleInvEvent.payload.investigate,
            keyFiles: [
              { path: 'apps/web/src/Sidebar.tsx', reason: 'primary fix' },
              { path: 'apps/web/src/Sidebar.test.ts', reason: 'must update assertion' },
              { path: 'apps/web/index.html', reason: 'title tag' },
            ],
            confidence: 'high',
          },
          investigationRunId: 'run-xyz',
        },
      },
    ]);

    const { dispatchFixIssue } = await import('./dispatch.js');
    await dispatchFixIssue('slug', 99).catch(() => {
      /* legacy dynamic import may fail in test env */
    });

    expect(mockLoggerInfo).toHaveBeenCalledWith(
      'dispatchFixIssue: simple bug → legacy single-agent path',
      expect.objectContaining({ slug: 'slug', issueNumber: 99 }),
    );
  });

  it('routes complex bug (3+ non-test files) to spec-author path', async () => {
    mockGetUseMultiAgentPipeline.mockReturnValue(true);
    mockGetProject.mockResolvedValue({
      id: 'slug',
      budgets: { maxParallelAgents: 1 },
      source: { repo: 'shaunnez/goose-hub', type: 'github' },
    });
    const bugItem = {
      id: 'item-bug',
      externalId: '100',
      title: 'complex bug',
      body: '',
      state: 'factory:dev-ready',
      schedule: 'current',
      type: 'bug',
    };
    mockGetSourceForSlug.mockResolvedValue(makeSource(bugItem));
    mockEventStoreReplay.mockReturnValue([complexInvEvent]);
    mockFilterEligibleByDependencies.mockResolvedValue({
      eligible: [],
      blocked: [],
      unregistered: [],
    });

    const { dispatchFixIssue } = await import('./dispatch.js');
    await dispatchFixIssue('slug', 100);

    expect(mockLoggerInfo).not.toHaveBeenCalledWith(
      'dispatchFixIssue: simple bug → legacy single-agent path',
      expect.anything(),
    );
    expect(mockLoggerInfo).toHaveBeenCalledWith(
      'dispatchFixIssue: pipeline flag',
      expect.objectContaining({ useMultiAgentPipeline: true }),
    );
  });

  it('routes bug with no investigation to legacy (fail-safe)', async () => {
    mockGetUseMultiAgentPipeline.mockReturnValue(true);
    mockGetProject.mockResolvedValue({ id: 'slug', budgets: { maxParallelAgents: 1 } });
    const bugItem = {
      id: 'item-bug',
      externalId: '101',
      title: 'untriaged bug',
      body: '',
      state: 'factory:dev-ready',
      schedule: 'current',
      type: 'bug',
    };
    mockGetSourceForSlug.mockResolvedValue(makeSource(bugItem));
    mockEventStoreReplay.mockReturnValue([]);

    const { dispatchFixIssue } = await import('./dispatch.js');
    await dispatchFixIssue('slug', 101).catch(() => {
      /* legacy dynamic import may fail */
    });

    expect(mockLoggerInfo).toHaveBeenCalledWith(
      'dispatchFixIssue: simple bug → legacy single-agent path',
      expect.objectContaining({ slug: 'slug', issueNumber: 101 }),
    );
  });

  it('routes feature items to spec-author regardless of investigation', async () => {
    mockGetUseMultiAgentPipeline.mockReturnValue(true);
    mockGetProject.mockResolvedValue({
      id: 'slug',
      budgets: { maxParallelAgents: 1 },
      source: { repo: 'shaunnez/goose-hub', type: 'github' },
    });
    const featureItem = {
      id: 'item-feat',
      externalId: '102',
      title: 'new feature',
      body: '',
      state: 'factory:dev-ready',
      schedule: 'current',
      type: 'feature',
    };
    mockGetSourceForSlug.mockResolvedValue(makeSource(featureItem));
    mockEventStoreReplay.mockReturnValue([simpleInvEvent]);
    mockFilterEligibleByDependencies.mockResolvedValue({
      eligible: [],
      blocked: [],
      unregistered: [],
    });

    const { dispatchFixIssue } = await import('./dispatch.js');
    await dispatchFixIssue('slug', 102);

    expect(mockLoggerInfo).not.toHaveBeenCalledWith(
      'dispatchFixIssue: simple bug → legacy single-agent path',
      expect.anything(),
    );
  });

  it('routes factory:from-prd child issues to legacy implementation even when multi-agent is enabled', async () => {
    mockGetUseMultiAgentPipeline.mockReturnValue(true);
    mockGetProject.mockResolvedValue({
      id: 'slug',
      budgets: { maxParallelAgents: 1 },
      source: { repo: 'shaunnez/goose-hub', type: 'github' },
    });
    const featureItem = {
      id: 'item-feat-child',
      externalId: '103',
      title: 'child feature',
      body: '',
      state: 'factory:dev-ready',
      schedule: 'current',
      type: 'feature',
    };
    mockGetSourceForSlug.mockResolvedValue({
      ...makeSource(featureItem),
      listLabels: vi.fn().mockResolvedValue(['factory:dev-ready', 'factory:from-prd']),
    });

    const { dispatchFixIssue } = await import('./dispatch.js');
    await dispatchFixIssue('slug', 103).catch(() => {
      /* legacy dynamic import may fail */
    });

    expect(mockLoggerInfo).toHaveBeenCalledWith(
      'dispatchFixIssue: PRD child projection → legacy single-agent path',
      expect.objectContaining({ slug: 'slug', issueNumber: 103 }),
    );
  });
});

// ─── pending-queue behaviour ──────────────────────────────────────────────

describe('pending queue: cap-full queuing and drain', () => {
  it('cap-full rejection queues work item (not logged as warn)', async () => {
    let resolveSource!: () => void;
    mockGetProject.mockResolvedValue({ budgets: { maxParallelAgents: 1 } });
    // First call blocks, keeping slot 1 occupied; second call returns null immediately.
    mockGetSourceForSlug
      .mockReturnValueOnce(
        new Promise<null>((r) => {
          resolveSource = () => r(null);
        }),
      )
      .mockResolvedValue(null);

    const { dispatchFixIssue } = await import('./dispatch.js');
    const p1 = dispatchFixIssue('slug', 5);

    // Wait for p1 to acquire the lock (its getMaxParallelAgents must have resolved).
    await vi.waitFor(() => {
      expect(mockGetSourceForSlug).toHaveBeenCalledTimes(1);
    });

    // Fire a second dispatch for a DIFFERENT issue — cap is full.
    await dispatchFixIssue('slug', 6);

    // Should NOT emit the "duplicate in-flight" warn (issue 6 is not in-flight).
    expect(mockLoggerWarn).not.toHaveBeenCalledWith(
      'dispatchFixIssue: duplicate in-flight, dropping',
      expect.objectContaining({ issueNumber: 6 }),
    );
    // Should be logged as a cap-full queue.
    expect(mockLoggerInfo).toHaveBeenCalledWith(
      'dispatchFixIssue: cap full, queuing work item',
      expect.objectContaining({ slug: 'slug', issueNumber: 6 }),
    );

    resolveSource();
    await p1;
    // Flush the drained dispatch (void, fire-and-forget) so it does not leak into the next test.
    await vi.waitFor(() => {
      expect(mockGetSourceForSlug).toHaveBeenCalledTimes(2);
    });
  });

  it('when a slot frees the pending item is dispatched', async () => {
    let resolveSource!: () => void;
    mockGetProject.mockResolvedValue({ budgets: { maxParallelAgents: 1 } });
    mockGetSourceForSlug
      .mockReturnValueOnce(
        new Promise<null>((r) => {
          resolveSource = () => r(null);
        }),
      )
      .mockResolvedValue(null); // second call (drain of issue 6) returns null → early return

    const { dispatchFixIssue } = await import('./dispatch.js');
    const p1 = dispatchFixIssue('slug', 5);

    await vi.waitFor(() => {
      expect(mockGetSourceForSlug).toHaveBeenCalledTimes(1);
    });

    await dispatchFixIssue('slug', 6); // cap-full → queued

    resolveSource();
    await p1;

    // drainPending fires dispatchFixIssue('slug', 6) which calls getSourceForSlug a second time.
    await vi.waitFor(() => {
      expect(mockGetSourceForSlug).toHaveBeenCalledTimes(2);
    });
  });

  it('per-issue duplicate (same issue already in-flight) is not queued', async () => {
    let resolveSource!: () => void;
    mockGetProject.mockResolvedValue({ budgets: { maxParallelAgents: 1 } });
    mockGetSourceForSlug.mockReturnValueOnce(
      new Promise<null>((r) => {
        resolveSource = () => r(null);
      }),
    );

    const { dispatchFixIssue } = await import('./dispatch.js');
    const p1 = dispatchFixIssue('slug', 5);
    // Duplicate for the SAME issue while in-flight.
    await dispatchFixIssue('slug', 5);

    // Must be logged as a duplicate drop, not as cap-full queue.
    expect(mockLoggerWarn).toHaveBeenCalledWith(
      'dispatchFixIssue: duplicate in-flight, dropping',
      expect.objectContaining({ slug: 'slug', issueNumber: 5 }),
    );
    expect(mockLoggerInfo).not.toHaveBeenCalledWith(
      'dispatchFixIssue: cap full, queuing work item',
      expect.anything(),
    );

    resolveSource();
    await p1;

    // Only one source lookup — the duplicate was dropped, not queued.
    expect(mockGetSourceForSlug).toHaveBeenCalledTimes(1);
  });

  it('same issue + same workflow already pending is not queued a second time', async () => {
    let resolveSource!: () => void;
    mockGetProject.mockResolvedValue({ budgets: { maxParallelAgents: 1 } });
    mockGetSourceForSlug
      .mockReturnValueOnce(
        new Promise<null>((r) => {
          resolveSource = () => r(null);
        }),
      )
      .mockResolvedValue(null);

    const { dispatchFixIssue } = await import('./dispatch.js');
    const p1 = dispatchFixIssue('slug', 5);

    await vi.waitFor(() => {
      expect(mockGetSourceForSlug).toHaveBeenCalledTimes(1);
    });

    // Both of these hit cap-full; only the first should be queued.
    await dispatchFixIssue('slug', 6);
    await dispatchFixIssue('slug', 6);

    resolveSource();
    await p1;

    // Issue 6 should be dispatched exactly once (drained once from the queue).
    await vi.waitFor(() => {
      expect(mockGetSourceForSlug).toHaveBeenCalledTimes(2);
    });
    expect(mockGetSourceForSlug).toHaveBeenCalledTimes(2);
  });

  it('different workflows for the same issue can each be queued independently', async () => {
    let resolveSource!: () => void;
    mockGetProject.mockResolvedValue({ budgets: { maxParallelAgents: 1 } });
    mockGetSourceForSlug
      .mockReturnValueOnce(
        new Promise<null>((r) => {
          resolveSource = () => r(null);
        }),
      )
      .mockResolvedValue(null);

    const { dispatchFixIssue, dispatchQa } = await import('./dispatch.js');
    const p1 = dispatchFixIssue('slug', 5);

    await vi.waitFor(() => {
      expect(mockGetSourceForSlug).toHaveBeenCalledTimes(1);
    });

    // Two different workflows for the same issue — both should be enqueued.
    await dispatchFixIssue('slug', 6);
    await dispatchQa('slug', 6);

    expect(mockLoggerInfo).toHaveBeenCalledWith(
      'dispatchFixIssue: cap full, queuing work item',
      expect.objectContaining({ issueNumber: 6 }),
    );
    expect(mockLoggerInfo).toHaveBeenCalledWith(
      'dispatchQa: cap full, queuing work item',
      expect.objectContaining({ issueNumber: 6 }),
    );

    resolveSource();
    await p1;

    // Both pending dispatches drain sequentially; getSourceForSlug called 3 times total.
    await vi.waitFor(() => {
      expect(mockGetSourceForSlug).toHaveBeenCalledTimes(3);
    });
  });
});

describe('dispatchQa acceptance commands', () => {
  it('preserves issue-body verify commands when engineering spec acceptance criteria win precedence', async () => {
    const source = {
      getItem: vi.fn().mockResolvedValue({
        id: 'github:o/r#42',
        repoRef: 'o/r',
        body: `## Acceptance criteria

- [ ] Kanban cards sort newest first
      Verify: pnpm vitest run apps/web/src/lib/lanes.config.test.ts
      Expected: pass
      Tolerance: exact`,
      }),
    };
    mockGetSourceForSlug.mockResolvedValue(source);
    mockGetEngineeringSpec.mockReturnValue({
      pipelineRunId: 'spec-run',
      updatedAt: '2026-05-21T00:00:00Z',
      spec: {
        acceptanceCriteria: [
          {
            id: 'AC-S',
            statement: 'Spec criterion without full verify fields',
            verifyCommand: 'pnpm test',
          },
        ],
      },
    });

    const { dispatchQa } = await import('./dispatch.js');
    await dispatchQa('slug', 42);

    expect(mockRunQaWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'github:o/r#42' }),
      source,
      'slug',
      'o/r',
      expect.objectContaining({
        verifyCommands: [
          {
            ac: 'Kanban cards sort newest first',
            command: 'pnpm vitest run apps/web/src/lib/lanes.config.test.ts',
            expected: 'pass',
            tolerance: 'exact',
          },
        ],
      }),
    );
  });
});

// ─── dispatchForLabel — label routing switch ─────────────────────────────

describe('dispatchForLabel', () => {
  it('routes factory:triaging to dispatchTriageBatch', async () => {
    const { dispatchForLabel } = await import('./dispatch.js');
    await dispatchForLabel('my-project', 1, 'factory:triaging');

    expect(mockRunTriageBatch).toHaveBeenCalledWith('my-project');
  });

  it(
    'routes factory:investigating to dispatchInvestigate (source null path)',
    { timeout: 30_000 },
    async () => {
      mockGetSourceForSlug.mockResolvedValue(null);

      const { dispatchForLabel } = await import('./dispatch.js');
      await expect(
        dispatchForLabel('my-project', 5, 'factory:investigating'),
      ).resolves.toBeUndefined();
      expect(mockLoggerError).toHaveBeenCalledWith(
        'dispatchInvestigate: no source for slug',
        expect.any(Object),
      );
    },
  );

  it(
    'routes factory:dev-ready to dispatchFixIssue (source null path)',
    { timeout: 30_000 },
    async () => {
      mockGetSourceForSlug.mockResolvedValue(null);

      const { dispatchForLabel } = await import('./dispatch.js');
      await expect(dispatchForLabel('my-project', 7, 'factory:dev-ready')).resolves.toBeUndefined();
      expect(mockLoggerError).toHaveBeenCalledWith(
        'dispatchFixIssue: no source for slug',
        expect.any(Object),
      );
    },
  );

  it('logs and does nothing for an unrecognised label (fallthrough)', async () => {
    const { dispatchForLabel } = await import('./dispatch.js');
    await expect(
      dispatchForLabel('my-project', 3, 'factory:unknown-label'),
    ).resolves.toBeUndefined();

    expect(mockLoggerInfo).toHaveBeenCalledWith(
      'dispatchForLabel: no workflow for label',
      expect.objectContaining({ labelName: 'factory:unknown-label' }),
    );
  });

  it('fallthrough: does not call triageBatch for unrecognised label', async () => {
    const { dispatchForLabel } = await import('./dispatch.js');
    await dispatchForLabel('my-project', 1, 'factory:needs-qa');

    expect(mockRunTriageBatch).not.toHaveBeenCalled();
  });

  it('routes factory:spec-ready through parallel-implement when M19 pipeline is enabled', async () => {
    const item = {
      id: 'github:shaunnez/goose-hub#694',
      externalId: '694',
      repoRef: 'shaunnez/goose-hub',
      title: 'parallel implement',
      body: 'body',
      state: 'factory:spec-ready',
      priority: 'high',
      type: 'feature',
      schedule: 'current',
    };
    const source = {
      repoRef: 'shaunnez/goose-hub',
      getItem: vi.fn().mockResolvedValue(item),
      transitionState: vi.fn().mockResolvedValue(undefined),
      comment: vi.fn().mockResolvedValue(undefined),
    };
    const spec = {
      objective: 'Implement dispatch wiring',
      userJourneys: [],
      functionalRequirements: [],
      architecture: { current: 'stub', new: 'wired', decisionRationale: 'test' },
      schemaChanges: { ddl: [], migrations: [] },
      interfaceContracts: [],
      workPackages: [
        {
          id: 'WP1',
          filesOwned: ['apps/server/src/shared/dispatch.ts'],
          changes: 'Wire it',
          dependsOn: [],
          builderTier: 'sonnet',
        },
      ],
      executionOrder: [{ batch: 0, wpIds: ['WP1'] }],
      verificationTooling: [],
      acceptanceCriteria: [
        { id: 'AC1', statement: 'Dispatches', verifyCommand: 'pnpm test', crossCutting: true },
      ],
      constraints: [],
      riskRegister: [],
      decisionSummaries: [{ kind: 'PLAN', summary: 'Test spec' }],
    };
    mockGetSourceForSlug.mockResolvedValue(source);
    mockGetProject.mockResolvedValue({
      id: 'project-config-id',
      budgets: { maxParallelAgents: 1 },
    });
    mockGetUseMultiAgentPipeline.mockReturnValue(true);
    mockGetEngineeringSpec.mockReturnValue({
      id: 1,
      projectId: 'goose-hub-self',
      workItemId: item.id,
      pipelineRunId: 'pipeline-run-dispatch',
      spec,
      createdAt: '2026-05-10T00:00:00Z',
      updatedAt: '2026-05-10T00:00:00Z',
    });

    const { dispatchForLabel } = await import('./dispatch.js');
    await dispatchForLabel('goose-hub-self', 694, 'factory:spec-ready');

    expect(mockGetUseMultiAgentPipeline).toHaveBeenCalledWith('project-config-id');
    expect(mockGetEngineeringSpec).toHaveBeenCalledWith('goose-hub-self', item.id);
    expect(source.transitionState).toHaveBeenNthCalledWith(
      1,
      '694',
      'factory:spec-ready',
      'factory:in-progress',
    );
    expect(mockRunParallelImplementWorkflow).toHaveBeenCalledWith(
      item,
      spec,
      'pipeline-run-dispatch',
      source,
      'goose-hub-self',
      expect.any(String),
      {},
    );
    expect(source.transitionState).toHaveBeenNthCalledWith(
      2,
      '694',
      'factory:in-progress',
      'factory:needs-qa',
    );
    expect(source.transitionState.mock.invocationCallOrder[0]).toBeLessThan(
      mockRunParallelImplementWorkflow.mock.invocationCallOrder[0],
    );
  });

  it('escalates factory:spec-ready to needs-human when the engineering spec is missing', async () => {
    const item = {
      id: 'github:shaunnez/goose-hub#694',
      externalId: '694',
      repoRef: 'shaunnez/goose-hub',
      title: 'parallel implement',
      body: 'body',
      state: 'factory:spec-ready',
      priority: 'high',
      type: 'feature',
      schedule: 'current',
    };
    const source = {
      repoRef: 'shaunnez/goose-hub',
      getItem: vi.fn().mockResolvedValue(item),
      transitionState: vi.fn().mockResolvedValue(undefined),
      comment: vi.fn().mockResolvedValue(undefined),
    };
    mockGetSourceForSlug.mockResolvedValue(source);
    mockGetProject.mockResolvedValue({
      id: 'project-config-id',
      budgets: { maxParallelAgents: 1 },
    });
    mockGetUseMultiAgentPipeline.mockReturnValue(true);
    mockGetEngineeringSpec.mockReturnValue(null);

    const { dispatchForLabel } = await import('./dispatch.js');
    await dispatchForLabel('goose-hub-self', 694, 'factory:spec-ready');

    expect(mockRunParallelImplementWorkflow).not.toHaveBeenCalled();
    expect(source.comment).toHaveBeenCalledWith('694', expect.stringContaining('engineering spec'));
    expect(source.transitionState).toHaveBeenCalledWith(
      '694',
      'factory:spec-ready',
      'factory:needs-human',
    );
  });

  it('transitions in-progress to needs-human when parallel-implement returns failed', async () => {
    const item = {
      id: 'github:shaunnez/goose-hub#694',
      externalId: '694',
      repoRef: 'shaunnez/goose-hub',
      title: 'parallel implement',
      body: 'body',
      state: 'factory:spec-ready',
      priority: 'high',
      type: 'feature',
      schedule: 'current',
    };
    const source = {
      repoRef: 'shaunnez/goose-hub',
      getItem: vi.fn().mockResolvedValue(item),
      transitionState: vi.fn().mockResolvedValue(undefined),
      comment: vi.fn().mockResolvedValue(undefined),
    };
    const spec = {
      objective: 'Implement dispatch wiring',
      userJourneys: [],
      functionalRequirements: [],
      architecture: { current: 'stub', new: 'wired', decisionRationale: 'test' },
      schemaChanges: { ddl: [], migrations: [] },
      interfaceContracts: [],
      workPackages: [
        {
          id: 'WP1',
          filesOwned: ['apps/server/src/shared/dispatch.ts'],
          changes: 'Wire it',
          dependsOn: [],
          builderTier: 'sonnet',
        },
      ],
      executionOrder: [{ batch: 0, wpIds: ['WP1'] }],
      verificationTooling: [],
      acceptanceCriteria: [
        { id: 'AC1', statement: 'Dispatches', verifyCommand: 'pnpm test', crossCutting: true },
      ],
      constraints: [],
      riskRegister: [],
      decisionSummaries: [{ kind: 'PLAN', summary: 'Test spec' }],
    };
    mockGetSourceForSlug.mockResolvedValue(source);
    mockGetProject.mockResolvedValue({
      id: 'project-config-id',
      budgets: { maxParallelAgents: 1 },
    });
    mockGetUseMultiAgentPipeline.mockReturnValue(true);
    mockGetEngineeringSpec.mockReturnValue({
      id: 1,
      projectId: 'goose-hub-self',
      workItemId: item.id,
      pipelineRunId: 'pipeline-run-dispatch',
      spec,
      createdAt: '2026-05-10T00:00:00Z',
      updatedAt: '2026-05-10T00:00:00Z',
    });
    mockRunParallelImplementWorkflow.mockResolvedValueOnce({
      status: 'failed',
      devRunId: 'dev-run-123',
      errorReason: 'builder failed',
    });

    const { dispatchForLabel } = await import('./dispatch.js');
    await dispatchForLabel('goose-hub-self', 694, 'factory:spec-ready');

    expect(source.transitionState).toHaveBeenNthCalledWith(
      1,
      '694',
      'factory:spec-ready',
      'factory:in-progress',
    );
    expect(source.transitionState).toHaveBeenNthCalledWith(
      2,
      '694',
      'factory:in-progress',
      'factory:needs-human',
    );
  });
});

// ─── dispatchRetro ────────────────────────────────────────────────────────

describe('dispatchRetro', () => {
  it('returns early and logs when source is null', { timeout: 30_000 }, async () => {
    mockGetSourceForSlug.mockResolvedValue(null);

    const { dispatchRetro } = await import('./dispatch.js');
    await expect(dispatchRetro('no-source', 42)).resolves.toBeUndefined();
    expect(mockLoggerError).toHaveBeenCalledWith(
      'dispatchRetro: no source for slug',
      expect.objectContaining({ slug: 'no-source' }),
    );
    expect(mockRunRetroForItem).not.toHaveBeenCalled();
  });

  it('skips items whose state has already advanced past factory:retrospecting', async () => {
    const source = {
      getItem: vi.fn().mockResolvedValue({ state: 'factory:done' }),
    };
    mockGetSourceForSlug.mockResolvedValue(source);

    const { dispatchRetro } = await import('./dispatch.js');
    await dispatchRetro('slug', 42);

    expect(mockRunRetroForItem).not.toHaveBeenCalled();
    expect(mockLoggerInfo).toHaveBeenCalledWith(
      'dispatchRetro: state already advanced, skipping',
      expect.objectContaining({ slug: 'slug', issueNumber: 42, state: 'factory:done' }),
    );
  });

  it('runs retro when item is in factory:retrospecting', async () => {
    const item = { state: 'factory:retrospecting' };
    const source = { getItem: vi.fn().mockResolvedValue(item) };
    mockGetSourceForSlug.mockResolvedValue(source);

    const { dispatchRetro } = await import('./dispatch.js');
    await dispatchRetro('slug', 42);

    expect(mockRunRetroForItem).toHaveBeenCalledWith(item, source, 'slug');
  });
});

// ─── dispatchGrillAndPrd — buildPriorReplies filtering ───────────────────

describe('dispatchGrillAndPrd: buildPriorReplies filtering', () => {
  it('excludes system-marker and child-issues; includes PRD as agent role', async () => {
    const source = {
      getItem: vi.fn().mockResolvedValue({ state: 'factory:grilling' }),
      listComments: vi
        .fn()
        .mockResolvedValue([
          { body: '<!-- factory:grill-question -->\n**Round 1** — What is the scope?' },
          { body: 'It is admin only.' },
          { body: '<!-- factory:system -->\nUser rejected the PRD; returning to grill.' },
          { body: '## Child issues\n- #10 slice 1' },
          { body: '<!-- factory:prd -->\n# PRD\n```json\n{}\n```' },
        ]),
    };
    mockGetSourceForSlug.mockResolvedValue(source);

    const { dispatchGrillAndPrd } = await import('./dispatch.js');
    await dispatchGrillAndPrd('slug', 99);

    expect(mockRunGrillAndPrdWorkflow).toHaveBeenCalledOnce();
    const call = mockRunGrillAndPrdWorkflow.mock.calls[0][0] as {
      priorReplies: Array<{ role: string; content: string }>;
    };
    // system-marker and child-issues excluded; PRD included as agent role
    expect(call.priorReplies).toHaveLength(3);
    expect(call.priorReplies[0].role).toBe('agent'); // grill question
    expect(call.priorReplies[1].role).toBe('user'); // user reply
    expect(call.priorReplies[1].content).toBe('It is admin only.');
    expect(call.priorReplies[2].role).toBe('agent'); // PRD draft
  });
});

// ─── dispatchDecomposePrd — no-PRD escape ────────────────────────────────

describe('dispatchDecomposePrd: no-PRD escape', () => {
  it('runs decompose from a local prd.drafted event without reading a marker comment', async () => {
    const item = { id: 'github:owner/repo#54', state: 'factory:decomposing' };
    const prd = { title: 'Local PRD' };
    const source = {
      getItem: vi.fn().mockResolvedValue(item),
      listComments: vi.fn().mockResolvedValue([]),
    };
    mockGetSourceForSlug.mockResolvedValue(source);
    mockEventStoreReplay.mockReturnValue([
      {
        id: 100,
        projectId: 'slug',
        workItemId: item.id,
        kind: 'prd.drafted',
        payload: { prd, advisorConcerns: null },
        runId: 'run-1',
        personaId: null,
        createdAt: '2026-05-21T00:00:00.000Z',
      },
    ]);

    const { dispatchDecomposePrd } = await import('./dispatch.js');
    await dispatchDecomposePrd('slug', 54);

    expect(source.listComments).not.toHaveBeenCalled();
    expect(mockRunDecomposePrdWorkflow).toHaveBeenCalledWith({
      workItem: item,
      prdOutput: prd,
      stateSource: source,
      projectId: 'slug',
    });
  });

  it('posts a comment and forces needs-human when no PRD draft is found', async () => {
    const source = {
      getItem: vi.fn().mockResolvedValue({
        id: 'github:owner/repo#55',
        state: 'factory:decomposing',
      }),
      listComments: vi.fn().mockResolvedValue([]),
      comment: vi.fn().mockResolvedValue(undefined),
      forceState: vi.fn().mockResolvedValue(undefined),
    };
    mockGetSourceForSlug.mockResolvedValue(source);

    const { dispatchDecomposePrd } = await import('./dispatch.js');
    await dispatchDecomposePrd('slug', 55);

    expect(mockLoggerError).toHaveBeenCalledWith(
      'dispatchDecomposePrd: no PRD draft found',
      expect.objectContaining({ slug: 'slug', issueNumber: 55 }),
    );
    expect(source.comment).toHaveBeenCalledWith(
      '55',
      expect.stringContaining('no PRD draft found'),
    );
    expect(source.forceState).toHaveBeenCalledWith('55', 'factory:needs-human');
  });
});
