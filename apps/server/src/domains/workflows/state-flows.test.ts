import type { AgentResult } from '@goose-hub/core/agent-runtime/interface.js';
import type { StateSource, WorkItem } from '@goose-hub/core/state-source/interface.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runQaBatch } from './qa-batch.js';
import { runReviewBatch } from './review-batch.js';
import { runTriageBatch } from './triage-batch.js';

// ─── Module-level mocks ──────────────────────────────────────────────────────

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
    .mockReturnValue({ personaId: 'goose-hub-self/triager/0', codename: 'Grey Honker' }),
}));

const mockAdviseOnPlan = vi.fn();
vi.mock('@goose-hub/core/agent-runtime/advisor.js', () => ({
  adviseOnPlan: mockAdviseOnPlan,
}));

vi.mock('@goose-hub/core/event-stream/store.js', () => ({
  eventStore: {
    appendEvent: vi.fn().mockReturnValue({ id: 1, kind: 'test', payload: {}, createdAt: '' }),
    replay: vi.fn().mockReturnValue([]),
  },
}));

vi.mock('@goose-hub/core/connectors/github/open-pr.js', () => ({
  openPR: vi.fn().mockResolvedValue({
    prNumber: 99,
    prUrl: 'https://github.com/test/pull/99',
    branch: 'factory/run-id',
    base: 'main',
  }),
}));

vi.mock('@goose-hub/core/persona/accumulate.js', () => ({
  accumulatePersonaStats: vi.fn(),
}));

vi.mock('@goose-hub/core/workspaces/worktree.js', () => ({
  createWorktree: vi.fn().mockReturnValue('/mock/worktree'),
  cleanupWorktree: vi.fn(),
  prewarmWorktree: vi.fn(),
  resolveWorktreeHeadSha: vi.fn().mockReturnValue('mock-sha-abc123'),
}));

const { mockGetSourceForSlug } = vi.hoisted(() => ({
  mockGetSourceForSlug: vi.fn(),
}));
vi.mock('../../shared/source.js', () => ({
  getSourceForSlug: mockGetSourceForSlug,
  isValidSlug: (s: string) => /^[a-zA-Z0-9_-]+$/.test(s),
}));

// ─── Factories ───────────────────────────────────────────────────────────────

function makeWorkItem(overrides: Partial<WorkItem> = {}): WorkItem {
  return {
    id: 'github:shaunnez/goose-hub#42',
    externalId: '42',
    repoRef: 'shaunnez/goose-hub',
    title: 'Test work item',
    body: 'Integration test fixture.',
    type: 'feature',
    priority: 'medium',
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

function makeMockSource(): StateSource {
  return {
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
    getPrDiff: vi.fn().mockResolvedValue(''),
    addLabels: vi.fn(),
    removeLabel: vi.fn(),
    listLabels: vi.fn().mockResolvedValue([]),
    watchForUpdates: vi.fn(),
  };
}

function makeAgentResult(output: unknown): AgentResult {
  return { output, decisionSummaries: [], events: [] };
}

function makeTriageOutput(type: 'feature' | 'bug' | 'research' | 'chore' = 'feature') {
  return {
    type,
    priority: 'p2',
    labels: [],
    reasoning: `Integration test: ${type}`,
    decisionSummaries: [{ kind: 'PLAN', summary: `Classified as ${type}` }],
  };
}

function makeRepoMatchOutput() {
  return {
    candidates: [{ repo: 'shaunnez/goose-hub', confidence: 95, evidence: 'name match', tier: 1 }],
    decisionSummaries: [],
  };
}

function makeImplementOutput() {
  return {
    plan: 'Integration test plan',
    filesWritten: [{ path: 'test.ts', reason: 'integration fixture' }],
    testsWritten: [],
    testsRun: { command: 'pnpm test ', paths: [] },
    prUrl: 'https://github.com/test/pull/99',
    evidenceSpecPath: null,
    confidence: 'high',
    decisionSummaries: [{ kind: 'GREEN', summary: 'Mock implementation' }],
  };
}

function makeInvestigateOutput() {
  return {
    findings: 'Integration test findings',
    keyFiles: [],
    confidence: 'high',
    openQuestions: [],
    requiresBrowserRepro: false,
    decisionSummaries: [{ kind: 'INSIGHT', summary: 'Mock investigation' }],
  };
}

function makePlaywrightReproOutput() {
  return {
    screenshots: [],
    gifPath: null,
    consoleErrors: [],
    reproSteps: ['Navigate to page'],
    reproduced: true,
  };
}

function makeQaOutput() {
  return {
    verdict: 'pass',
    overallScore: 100,
    threshold: 70,
    tierResults: {
      structural: { passed: true, findings: [] },
      functional: { passed: true, findings: [] },
      regression: { passed: true, findings: [] },
    },
    qualityScores: {
      openClosed: 20,
      conceptCount: 15,
      timeToCapability: 15,
      complecting: 15,
      loc: 10,
      coupling: 10,
      gallsLaw: 10,
      cyclomaticComplexity: 5,
    },
    findings: [],
    decisionSummaries: [{ kind: 'VERDICT', summary: 'Mock QA pass' }],
  };
}

function makeReviewOutput() {
  return {
    verdict: 'approved',
    confidence: 0.95,
    criteriaChecks: [],
    findings: [],
    decisionSummaries: [{ kind: 'VERDICT', summary: 'Mock review approval' }],
  };
}

function makeAdvisorOutput(verdict: 'proceed' | 'revise' | 'abort') {
  if (verdict === 'proceed') {
    return {
      verdict: 'proceed' as const,
      confidence: 'high' as const,
      decisionSummaries: [{ kind: 'VERDICT', summary: 'Advisor: proceed' }],
    };
  }
  if (verdict === 'revise') {
    return {
      verdict: 'revise' as const,
      feedback: 'Revise the approach for integration test',
      confidence: 'medium' as const,
      decisionSummaries: [{ kind: 'VERDICT', summary: 'Advisor: revise' }],
    };
  }
  return {
    verdict: 'abort' as const,
    reason: 'Plan is out of scope for integration test',
    confidence: 'low' as const,
    decisionSummaries: [{ kind: 'VERDICT', summary: 'Advisor: abort' }],
  };
}

const SLUG = 'goose-hub-self';

// ─── Shared beforeEach ───────────────────────────────────────────────────────
// mockRun.mockReset() prevents leftover mockResolvedValueOnce values from
// bleeding across tests when a previous test fails before consuming all values.

beforeEach(() => {
  vi.clearAllMocks();
  mockRun.mockReset();
  // fix-issue workflow checks GITHUB_TOKEN before calling openPRFn
  process.env.GITHUB_TOKEN = 'mock-github-token';
});

// ─── Layer A: Triage ─────────────────────────────────────────────────────────

describe('Layer A: Triage state paths', () => {
  it('routes fresh feature (no factory:from-prd) to factory:grilling via factory:accepted', async () => {
    // Fresh features (no factory:from-prd) enter the Discover Lane via grilling.
    // listLabels returns [] by default (no factory:from-prd).
    const item = makeWorkItem({ state: 'factory:triaging', type: 'feature' });
    const source = makeMockSource();
    (source.listOpenWork as ReturnType<typeof vi.fn>).mockResolvedValue([item]);

    mockRun
      .mockResolvedValueOnce(makeAgentResult(makeTriageOutput('feature')))
      .mockResolvedValueOnce(makeAgentResult(makeRepoMatchOutput()));

    await runTriageBatch(SLUG, source);

    expect(source.transitionState).toHaveBeenNthCalledWith(
      1,
      '42',
      'factory:triaging',
      'factory:accepted',
    );
    expect(source.transitionState).toHaveBeenNthCalledWith(
      2,
      '42',
      'factory:accepted',
      'factory:grilling',
    );
    expect(source.transitionState).toHaveBeenCalledTimes(2);
  });

  it('routes bug to factory:investigating via factory:accepted', async () => {
    const item = makeWorkItem({ state: 'factory:triaging', type: 'bug' });
    const source = makeMockSource();
    (source.listOpenWork as ReturnType<typeof vi.fn>).mockResolvedValue([item]);

    mockRun
      .mockResolvedValueOnce(makeAgentResult(makeTriageOutput('bug')))
      .mockResolvedValueOnce(makeAgentResult(makeRepoMatchOutput()));

    await runTriageBatch(SLUG, source);

    expect(source.transitionState).toHaveBeenNthCalledWith(
      1,
      '42',
      'factory:triaging',
      'factory:accepted',
    );
    expect(source.transitionState).toHaveBeenNthCalledWith(
      2,
      '42',
      'factory:accepted',
      'factory:investigating',
    );
    expect(source.transitionState).toHaveBeenCalledTimes(2);
  });

  it('routes research to factory:research-pending via factory:accepted', async () => {
    const item = makeWorkItem({ state: 'factory:triaging', type: 'feature' });
    const source = makeMockSource();
    (source.listOpenWork as ReturnType<typeof vi.fn>).mockResolvedValue([item]);

    mockRun
      .mockResolvedValueOnce(makeAgentResult(makeTriageOutput('research')))
      .mockResolvedValueOnce(makeAgentResult(makeRepoMatchOutput()));

    await runTriageBatch(SLUG, source);

    expect(source.transitionState).toHaveBeenNthCalledWith(
      1,
      '42',
      'factory:triaging',
      'factory:accepted',
    );
    expect(source.transitionState).toHaveBeenNthCalledWith(
      2,
      '42',
      'factory:accepted',
      'factory:research-pending',
    );
    expect(source.transitionState).toHaveBeenCalledTimes(2);
  });
});

// ─── Layer A: Fix-issue ───────────────────────────────────────────────────────

describe('Layer A: Fix-issue state paths', () => {
  async function runFixIssueAndChain(
    source: StateSource,
    devReadyItem: WorkItem,
    opts: {
      mockRunValues: ReturnType<typeof makeAgentResult>[];
      advisorOutput?: ReturnType<typeof makeAdvisorOutput>;
      includeQaReview?: boolean;
    },
  ) {
    const { dispatchFixIssue } = await import('../../shared/dispatch.js');
    mockGetSourceForSlug.mockResolvedValue(source);
    (source.getItem as ReturnType<typeof vi.fn>).mockResolvedValue(devReadyItem);

    if (opts.advisorOutput) {
      mockAdviseOnPlan.mockResolvedValueOnce(opts.advisorOutput);
    }
    for (const val of opts.mockRunValues) {
      mockRun.mockResolvedValueOnce(val);
    }

    await dispatchFixIssue(SLUG, 42);

    if (opts.includeQaReview) {
      const qaItem = makeWorkItem({ state: 'factory:needs-qa' });
      const reviewItem = makeWorkItem({ state: 'factory:needs-review' });
      (source.listOpenWork as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce([qaItem])
        .mockResolvedValueOnce([reviewItem]);
      await runQaBatch(SLUG, source);
      await runReviewBatch(SLUG, source);
    }
  }

  it('happy path (medium priority): dev-ready → approved', async () => {
    const source = makeMockSource();
    const devReadyItem = makeWorkItem({ state: 'factory:dev-ready', priority: 'medium' });

    await runFixIssueAndChain(source, devReadyItem, {
      mockRunValues: [
        makeAgentResult(makeImplementOutput()),
        makeAgentResult(makeQaOutput()),
        makeAgentResult(makeReviewOutput()),
      ],
      includeQaReview: true,
    });

    expect(source.transitionState).toHaveBeenNthCalledWith(
      1,
      '42',
      'factory:dev-ready',
      'factory:in-progress',
    );
    expect(source.transitionState).toHaveBeenNthCalledWith(
      2,
      '42',
      'factory:in-progress',
      'factory:needs-qa',
    );
    expect(source.transitionState).toHaveBeenNthCalledWith(
      3,
      '42',
      'factory:needs-qa',
      'factory:needs-review',
    );
    expect(source.transitionState).toHaveBeenNthCalledWith(
      4,
      '42',
      'factory:needs-review',
      'factory:approved',
    );
    expect(source.transitionState).toHaveBeenCalledTimes(4);
  });

  it('failure (invalid implement output): dev-ready → needs-human', async () => {
    const source = makeMockSource();
    const devReadyItem = makeWorkItem({ state: 'factory:dev-ready', priority: 'medium' });

    await runFixIssueAndChain(source, devReadyItem, {
      mockRunValues: [makeAgentResult({ invalid: 'garbage output that fails ImplementSchema' })],
    });

    expect(source.transitionState).toHaveBeenNthCalledWith(
      1,
      '42',
      'factory:dev-ready',
      'factory:in-progress',
    );
    expect(source.transitionState).toHaveBeenNthCalledWith(
      2,
      '42',
      'factory:in-progress',
      'factory:needs-human',
    );
    expect(source.transitionState).toHaveBeenCalledTimes(2);
    expect(source.comment).toHaveBeenCalled();
  });

  it('advisor proceed (high priority): dev-ready → approved', async () => {
    const source = makeMockSource();
    const devReadyItem = makeWorkItem({ state: 'factory:dev-ready', priority: 'high' });

    await runFixIssueAndChain(source, devReadyItem, {
      // plan run only (proceed re-uses plan output); no second implement run
      mockRunValues: [
        makeAgentResult(makeImplementOutput()),
        makeAgentResult(makeQaOutput()),
        makeAgentResult(makeReviewOutput()),
      ],
      advisorOutput: makeAdvisorOutput('proceed'),
      includeQaReview: true,
    });

    expect(source.transitionState).toHaveBeenNthCalledWith(
      1,
      '42',
      'factory:dev-ready',
      'factory:in-progress',
    );
    expect(source.transitionState).toHaveBeenNthCalledWith(
      2,
      '42',
      'factory:in-progress',
      'factory:needs-qa',
    );
    expect(source.transitionState).toHaveBeenNthCalledWith(
      3,
      '42',
      'factory:needs-qa',
      'factory:needs-review',
    );
    expect(source.transitionState).toHaveBeenNthCalledWith(
      4,
      '42',
      'factory:needs-review',
      'factory:approved',
    );
    expect(source.transitionState).toHaveBeenCalledTimes(4);
    expect(mockAdviseOnPlan).toHaveBeenCalledTimes(1);
    // Plan run + qa + review (proceed reuses plan output, no second implement)
    expect(mockRun).toHaveBeenCalledTimes(3);
  });

  it('advisor revise (high priority): dev-ready → approved', async () => {
    const source = makeMockSource();
    const devReadyItem = makeWorkItem({ state: 'factory:dev-ready', priority: 'high' });

    await runFixIssueAndChain(source, devReadyItem, {
      // plan run → revise → revision run → qa → review
      mockRunValues: [
        makeAgentResult(makeImplementOutput()), // plan run
        makeAgentResult(makeImplementOutput()), // revision run
        makeAgentResult(makeQaOutput()),
        makeAgentResult(makeReviewOutput()),
      ],
      advisorOutput: makeAdvisorOutput('revise'),
      includeQaReview: true,
    });

    expect(source.transitionState).toHaveBeenNthCalledWith(
      1,
      '42',
      'factory:dev-ready',
      'factory:in-progress',
    );
    expect(source.transitionState).toHaveBeenNthCalledWith(
      2,
      '42',
      'factory:in-progress',
      'factory:needs-qa',
    );
    expect(source.transitionState).toHaveBeenNthCalledWith(
      3,
      '42',
      'factory:needs-qa',
      'factory:needs-review',
    );
    expect(source.transitionState).toHaveBeenNthCalledWith(
      4,
      '42',
      'factory:needs-review',
      'factory:approved',
    );
    expect(source.transitionState).toHaveBeenCalledTimes(4);
    expect(mockRun).toHaveBeenCalledTimes(4); // plan + revision + qa + review
  });

  it('advisor abort (high priority): dev-ready → needs-human', async () => {
    const source = makeMockSource();
    const devReadyItem = makeWorkItem({ state: 'factory:dev-ready', priority: 'high' });

    await runFixIssueAndChain(source, devReadyItem, {
      mockRunValues: [makeAgentResult(makeImplementOutput())], // plan run only
      advisorOutput: makeAdvisorOutput('abort'),
    });

    expect(source.transitionState).toHaveBeenNthCalledWith(
      1,
      '42',
      'factory:dev-ready',
      'factory:in-progress',
    );
    expect(source.transitionState).toHaveBeenNthCalledWith(
      2,
      '42',
      'factory:in-progress',
      'factory:needs-human',
    );
    expect(source.transitionState).toHaveBeenCalledTimes(2);
    expect(source.comment).toHaveBeenCalled();
    expect(mockAdviseOnPlan).toHaveBeenCalledTimes(1);
    expect(mockRun).toHaveBeenCalledTimes(1); // plan run only
  });
});

// ─── Layer A: Investigate ─────────────────────────────────────────────────────

describe('Layer A: Investigate state paths', () => {
  it('happy path: investigating → investigation-complete', async () => {
    const { dispatchInvestigate } = await import('../../shared/dispatch.js');
    const item = makeWorkItem({ state: 'factory:investigating', type: 'bug' });
    const source = makeMockSource();
    mockGetSourceForSlug.mockResolvedValue(source);
    (source.getItem as ReturnType<typeof vi.fn>).mockResolvedValue(item);

    // bug items run investigate then playwright-repro (non-fatal if repro fails schema)
    mockRun
      .mockResolvedValueOnce(makeAgentResult(makeInvestigateOutput()))
      .mockResolvedValueOnce(makeAgentResult(makePlaywrightReproOutput()));

    await dispatchInvestigate(SLUG, 42);

    expect(source.transitionState).toHaveBeenNthCalledWith(
      1,
      '42',
      'factory:investigating',
      'factory:investigation-complete',
    );
    expect(source.transitionState).toHaveBeenCalledTimes(1);
  });

  it('failure (invalid output): investigating → needs-human', async () => {
    const { dispatchInvestigate } = await import('../../shared/dispatch.js');
    const item = makeWorkItem({ state: 'factory:investigating', type: 'bug' });
    const source = makeMockSource();
    mockGetSourceForSlug.mockResolvedValue(source);
    (source.getItem as ReturnType<typeof vi.fn>).mockResolvedValue(item);

    mockRun.mockResolvedValueOnce(makeAgentResult({ invalid: 'garbage' }));

    await dispatchInvestigate(SLUG, 42);

    expect(source.transitionState).toHaveBeenNthCalledWith(
      1,
      '42',
      'factory:investigating',
      'factory:needs-human',
    );
    expect(source.transitionState).toHaveBeenCalledTimes(1);
    expect(source.comment).toHaveBeenCalled();
  });
});

// ─── Layer B: Dispatch chain ──────────────────────────────────────────────────
//
// HTTP routing is tested by handler.test.ts. These tests call dispatchForLabel
// directly so the full dispatch → workflow → state chain is synchronously awaitable
// without floating-Promise interference with the mockRun queue.

describe('Layer B: Full dispatch chain (dispatchForLabel → workflow → state)', () => {
  it('dispatchForLabel triaging → triage batch → factory:grilling (fresh feature)', async () => {
    // Fresh features route to grilling, not dev-ready.
    const { dispatchForLabel } = await import('../../shared/dispatch.js');
    const item = makeWorkItem({ state: 'factory:triaging', type: 'feature' });
    const source = makeMockSource();
    (source.listOpenWork as ReturnType<typeof vi.fn>).mockResolvedValue([item]);
    mockGetSourceForSlug.mockResolvedValue(source);
    mockRun
      .mockResolvedValueOnce(makeAgentResult(makeTriageOutput('feature')))
      .mockResolvedValueOnce(makeAgentResult(makeRepoMatchOutput()));

    await dispatchForLabel(SLUG, 42, 'factory:triaging');

    expect(source.transitionState).toHaveBeenNthCalledWith(
      1,
      '42',
      'factory:triaging',
      'factory:accepted',
    );
    expect(source.transitionState).toHaveBeenNthCalledWith(
      2,
      '42',
      'factory:accepted',
      'factory:grilling',
    );
    expect(source.transitionState).toHaveBeenCalledTimes(2);
  });

  it('dispatchForLabel dev-ready → fix-issue → factory:needs-qa', async () => {
    const { dispatchForLabel } = await import('../../shared/dispatch.js');
    const item = makeWorkItem({ state: 'factory:dev-ready', priority: 'medium' });
    const source = makeMockSource();
    (source.getItem as ReturnType<typeof vi.fn>).mockResolvedValue(item);
    mockGetSourceForSlug.mockResolvedValue(source);
    mockRun.mockResolvedValueOnce(makeAgentResult(makeImplementOutput()));

    await dispatchForLabel(SLUG, 42, 'factory:dev-ready');

    expect(source.transitionState).toHaveBeenNthCalledWith(
      1,
      '42',
      'factory:dev-ready',
      'factory:in-progress',
    );
    expect(source.transitionState).toHaveBeenNthCalledWith(
      2,
      '42',
      'factory:in-progress',
      'factory:needs-qa',
    );
    expect(source.transitionState).toHaveBeenCalledTimes(2);
  });

  it('dispatchForLabel investigating → investigate → factory:investigation-complete', async () => {
    const { dispatchForLabel } = await import('../../shared/dispatch.js');
    const item = makeWorkItem({ state: 'factory:investigating', type: 'bug' });
    const source = makeMockSource();
    (source.getItem as ReturnType<typeof vi.fn>).mockResolvedValue(item);
    mockGetSourceForSlug.mockResolvedValue(source);
    mockRun
      .mockResolvedValueOnce(makeAgentResult(makeInvestigateOutput()))
      .mockResolvedValueOnce(makeAgentResult(makePlaywrightReproOutput()));

    await dispatchForLabel(SLUG, 42, 'factory:investigating');

    expect(source.transitionState).toHaveBeenNthCalledWith(
      1,
      '42',
      'factory:investigating',
      'factory:investigation-complete',
    );
    expect(source.transitionState).toHaveBeenCalledTimes(1);
  });

  it('full chore pipeline: triaging → dev-ready → factory:approved', async () => {
    const { dispatchForLabel } = await import('../../shared/dispatch.js');
    const source = makeMockSource();
    // Use type:chore — chores route directly to dev-ready (no grilling)
    const trigItem = makeWorkItem({ state: 'factory:triaging', type: 'chore' });
    const devReadyItem = makeWorkItem({ state: 'factory:dev-ready', priority: 'medium' });

    mockGetSourceForSlug.mockResolvedValue(source);
    (source.listOpenWork as ReturnType<typeof vi.fn>).mockResolvedValue([trigItem]);
    (source.getItem as ReturnType<typeof vi.fn>).mockResolvedValue(devReadyItem);

    // Phase 1: triage
    mockRun
      .mockResolvedValueOnce(makeAgentResult(makeTriageOutput('chore')))
      .mockResolvedValueOnce(makeAgentResult(makeRepoMatchOutput()));

    await dispatchForLabel(SLUG, 42, 'factory:triaging');

    expect(source.transitionState).toHaveBeenNthCalledWith(
      1,
      '42',
      'factory:triaging',
      'factory:accepted',
    );
    expect(source.transitionState).toHaveBeenNthCalledWith(
      2,
      '42',
      'factory:accepted',
      'factory:dev-ready',
    );

    // Phase 2: fix-issue
    mockRun.mockResolvedValueOnce(makeAgentResult(makeImplementOutput()));

    await dispatchForLabel(SLUG, 42, 'factory:dev-ready');

    expect(source.transitionState).toHaveBeenNthCalledWith(
      3,
      '42',
      'factory:dev-ready',
      'factory:in-progress',
    );
    expect(source.transitionState).toHaveBeenNthCalledWith(
      4,
      '42',
      'factory:in-progress',
      'factory:needs-qa',
    );

    // Phase 3: QA + review
    (source.listOpenWork as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([makeWorkItem({ state: 'factory:needs-qa' })])
      .mockResolvedValueOnce([makeWorkItem({ state: 'factory:needs-review' })]);
    mockRun
      .mockResolvedValueOnce(makeAgentResult(makeQaOutput()))
      .mockResolvedValueOnce(makeAgentResult(makeReviewOutput()));

    await runQaBatch(SLUG, source);
    await runReviewBatch(SLUG, source);

    const calls = (source.transitionState as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls[4]).toEqual(['42', 'factory:needs-qa', 'factory:needs-review']);
    expect(calls[5]).toEqual(['42', 'factory:needs-review', 'factory:approved']);
    expect(source.transitionState).toHaveBeenCalledTimes(6);
  });
});
