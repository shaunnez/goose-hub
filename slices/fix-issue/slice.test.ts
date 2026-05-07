import type { AgentResult, AgentRuntime } from '@goose-hub/core/agent-runtime/interface.js';
import type { StateSource, WorkItem } from '@goose-hub/core/state-source/interface.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@goose-hub/core/event-stream/store.js', () => ({
  eventStore: {
    appendEvent: vi.fn().mockReturnValue({ id: 1 }),
    replay: vi.fn().mockReturnValue([]),
  },
}));
vi.mock('@goose-hub/core/agent-runtime/select-persona.js', () => ({
  selectPersona: vi
    .fn()
    .mockReturnValue({ personaId: 'proj/developer/0', codename: 'Grey Honker' }),
}));
const mockAccumulatePersonaStats = vi.fn();
vi.mock('@goose-hub/core/persona/accumulate.js', () => ({
  accumulatePersonaStats: (...args: unknown[]) => mockAccumulatePersonaStats(...args),
}));
vi.mock('@goose-hub/core/agent-runtime/schema-bridge.js', () => ({
  toJsonSchema: vi.fn().mockReturnValue({}),
}));
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return { ...actual, readFileSync: vi.fn().mockReturnValue('# mock skill prompt') };
});

// Mock default dep implementations so the ?? fallback branches (lines 68-73) are reachable
const mockClaudeCliRun = vi.fn();
vi.mock('@goose-hub/core/agent-runtime/claude-cli.js', () => ({
  ClaudeCliRuntime: vi.fn().mockImplementation(() => ({ run: mockClaudeCliRun })),
}));
const mockOpenPR = vi
  .fn()
  .mockResolvedValue({ prNumber: 1, prUrl: 'u', branch: 'b', base: 'main' });
vi.mock('@goose-hub/core/connectors/github/open-pr.js', () => ({
  openPR: (...args: unknown[]) => mockOpenPR(...args),
}));
const mockAdviseOnPlan = vi.fn();
vi.mock('@goose-hub/core/agent-runtime/advisor.js', () => ({
  adviseOnPlan: (...args: unknown[]) => mockAdviseOnPlan(...args),
}));
const mockCreateWorktree = vi.fn().mockReturnValue('/work/wt');
const mockCleanupWorktree = vi.fn();
const mockPrewarmWorktree = vi.fn();
vi.mock('@goose-hub/core/workspaces/worktree.js', () => ({
  createWorktree: (...args: unknown[]) => mockCreateWorktree(...args),
  cleanupWorktree: (...args: unknown[]) => mockCleanupWorktree(...args),
  prewarmWorktree: (...args: unknown[]) => mockPrewarmWorktree(...args),
}));

import { eventStore } from '@goose-hub/core/event-stream/store.js';

function makeWorkItem(overrides: Partial<WorkItem> = {}): WorkItem {
  return {
    id: 'github:owner/repo#42',
    externalId: '42',
    repoRef: 'owner/repo',
    title: 'Add capitalize helper',
    body: 'Add capitalize(s) to core/utils/strings.ts',
    type: 'chore',
    priority: 'medium',
    mode: 'supervised',
    state: 'factory:dev-ready',
    authorIsOwner: true,
    schedule: 'current',
    exec: 'serial',
    dependsOn: [],
    blocks: [],
    createdAt: new Date(),
    ...overrides,
  };
}

function makeStateSource(): StateSource {
  return {
    projectId: 'proj',
    repoRef: 'owner/repo',
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
    watchForUpdates: vi.fn(),
  };
}

function makeImplementOutput(overrides: Record<string, unknown> = {}) {
  return {
    plan: '1. Tests; 2. Implementation; 3. Lint.',
    filesWritten: [
      { path: 'core/utils/strings.ts', reason: 'new helper' },
      { path: 'core/utils/strings.test.ts', reason: 'tests' },
    ],
    testsWritten: [{ path: 'core/utils/strings.test.ts', cases: 3 }],
    testsRun: {
      command: 'pnpm test ',
      paths: ['core/utils/strings.test.ts'],
    },
    prUrl: 'https://github.com/owner/repo/issues/42',
    evidenceSpecPath: null as string | null,
    confidence: 'high' as const,
    decisionSummaries: [
      { kind: 'PLAN', summary: 'Add helper at core/utils/strings.ts' },
      { kind: 'GREEN', summary: 'All 3 tests pass' },
    ],
    ...overrides,
  };
}

describe('runFixIssueWorkflow — default deps (lines 68-73 ?? fallbacks)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAccumulatePersonaStats.mockClear();
    process.env.GITHUB_TOKEN = 'ghp_test';
    mockClaudeCliRun.mockResolvedValueOnce({
      output: makeImplementOutput(),
      decisionSummaries: [],
      events: [],
    } satisfies AgentResult);
  });

  afterEach(() => {
    process.env.GITHUB_TOKEN = undefined;
  });

  it('uses default implementations when no deps provided (covers ?? fallback branches)', async () => {
    const item = makeWorkItem({ priority: 'medium' });
    const source = makeStateSource();

    const { runFixIssueWorkflow } = await import('./workflow.js');
    // Call with no deps — exercises lines 68-73 ?? fallbacks for all default values
    await runFixIssueWorkflow(item, source, 'proj', '/repo');

    // ClaudeCliRuntime was used (default runtime dep)
    expect(mockClaudeCliRun).toHaveBeenCalledTimes(1);
    // createWorktree was called (default worktree dep)
    expect(mockCreateWorktree).toHaveBeenCalledWith('/repo', expect.any(String));
    // openPR was called (default openPR dep)
    expect(mockOpenPR).toHaveBeenCalled();
    // worktree persists until merge — NOT cleaned up after PR open
    expect(mockCleanupWorktree).not.toHaveBeenCalled();
  });
});

describe('runFixIssueWorkflow (#183)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAccumulatePersonaStats.mockClear();
    process.env.GITHUB_TOKEN = 'ghp_test';
  });

  afterEach(() => {
    process.env.GITHUB_TOKEN = undefined;
  });

  it('happy path (priority:medium, no advisor): worktree → in-progress → implement → PR → needs-qa', async () => {
    const item = makeWorkItem({ priority: 'medium' });
    const source = makeStateSource();

    const runtime: AgentRuntime = {
      run: vi.fn().mockResolvedValueOnce({
        output: makeImplementOutput(),
        decisionSummaries: [],
        events: [],
      } satisfies AgentResult),
    };

    const openPRImpl = vi.fn().mockResolvedValue({
      prNumber: 100,
      prUrl: 'https://github.com/owner/repo/pull/100',
      branch: 'factory/abc',
      base: 'main',
    });
    const adviseOnPlanImpl = vi.fn();
    const createWorktreeImpl = vi.fn().mockReturnValue('/work/wt');
    const cleanupWorktreeImpl = vi.fn();
    const resolveWorktreeHeadShaImpl = vi
      .fn()
      .mockReturnValue('abc1234567890abcdef1234567890abcdef1234');

    const { runFixIssueWorkflow } = await import('./workflow.js');
    await runFixIssueWorkflow(item, source, 'proj', '/repo', {
      runtime,
      openPRImpl,
      adviseOnPlanImpl,
      createWorktreeImpl,
      cleanupWorktreeImpl,
      resolveWorktreeHeadShaImpl,
    });

    expect(createWorktreeImpl).toHaveBeenCalledWith('/repo', expect.any(String));
    expect(source.transitionState).toHaveBeenNthCalledWith(
      1,
      '42',
      'factory:dev-ready',
      'factory:in-progress',
    );
    expect(adviseOnPlanImpl).not.toHaveBeenCalled();
    expect(runtime.run).toHaveBeenCalledTimes(1); // implement only — no advisor, no evidence (null specPath)
    expect(openPRImpl).toHaveBeenCalled();
    const prCall = vi.mocked(openPRImpl).mock.calls[0][0];
    expect(prCall.repo).toBe('owner/repo');
    expect(prCall.issueNumber).toBe(42);
    expect(prCall.body).toContain('Closes #42');
    expect(prCall.body).not.toMatch(/decision|reasoning|chain[- ]of[- ]thought/i);
    expect(source.transitionState).toHaveBeenLastCalledWith(
      '42',
      'factory:in-progress',
      'factory:needs-qa',
    );
    // worktree persists until merge — NOT cleaned up after PR open
    expect(cleanupWorktreeImpl).not.toHaveBeenCalled();
    // pr.opened event recorded with worktreePath and devRunId for QA and merge cleanup
    const opened = vi
      .mocked(eventStore.appendEvent)
      .mock.calls.find(([e]) => e.kind === 'pr.opened');
    expect(opened).toBeDefined();
    const openedPayload = opened?.[0].payload as Record<string, unknown>;
    expect(openedPayload).toHaveProperty('worktreePath');
    expect(openedPayload).toHaveProperty('devRunId');
    expect(mockAccumulatePersonaStats).toHaveBeenCalledWith({
      personaName: 'proj/developer/0',
      role: 'developer',
      outcome: 'success',
    });
  });

  it('priority:high — advisor proceed verdict short-circuits to PR (no re-spawn)', async () => {
    const item = makeWorkItem({ priority: 'high' });
    const source = makeStateSource();
    const runtime: AgentRuntime = {
      run: vi.fn().mockResolvedValueOnce({
        output: makeImplementOutput(),
        decisionSummaries: [],
        events: [],
      } satisfies AgentResult),
    };
    const openPRImpl = vi.fn().mockResolvedValue({
      prNumber: 1,
      prUrl: 'u',
      branch: 'b',
      base: 'main',
    });
    const adviseOnPlanImpl = vi.fn().mockResolvedValue({
      verdict: 'proceed',
      confidence: 'high',
      decisionSummaries: [{ kind: 'VERDICT', summary: 'sound' }],
    });

    const { runFixIssueWorkflow } = await import('./workflow.js');
    await runFixIssueWorkflow(item, source, 'proj', '/repo', {
      runtime,
      openPRImpl,
      adviseOnPlanImpl,
      createWorktreeImpl: vi.fn().mockReturnValue('/work/wt'),
      cleanupWorktreeImpl: vi.fn(),
      resolveWorktreeHeadShaImpl: vi
        .fn()
        .mockReturnValue('abc1234567890abcdef1234567890abcdef1234'),
    });

    expect(adviseOnPlanImpl).toHaveBeenCalledTimes(1);
    expect(runtime.run).toHaveBeenCalledTimes(1); // implement once; advisor proceed → no re-spawn
    expect(openPRImpl).toHaveBeenCalled();
    expect(mockAccumulatePersonaStats).toHaveBeenCalledWith({
      personaName: 'proj/developer/0',
      role: 'developer',
      outcome: 'success',
    });
  });

  it('priority:critical — advisor revise verdict re-spawns implement once with feedback', async () => {
    const item = makeWorkItem({ priority: 'critical' });
    const source = makeStateSource();
    const runMock = vi
      .fn()
      .mockResolvedValueOnce({
        output: makeImplementOutput({ plan: 'Original plan' }),
        decisionSummaries: [],
        events: [],
      } satisfies AgentResult)
      .mockResolvedValueOnce({
        output: makeImplementOutput({ plan: 'Revised plan' }),
        decisionSummaries: [],
        events: [],
      } satisfies AgentResult);
    const runtime: AgentRuntime = { run: runMock };
    const openPRImpl = vi.fn().mockResolvedValue({
      prNumber: 1,
      prUrl: 'u',
      branch: 'b',
      base: 'main',
    });
    const adviseOnPlanImpl = vi.fn().mockResolvedValue({
      verdict: 'revise',
      confidence: 'medium',
      feedback: 'use the existing helper at X',
      decisionSummaries: [{ kind: 'VERDICT', summary: 'duplicates X' }],
    });

    const { runFixIssueWorkflow } = await import('./workflow.js');
    await runFixIssueWorkflow(item, source, 'proj', '/repo', {
      runtime,
      openPRImpl,
      adviseOnPlanImpl,
      createWorktreeImpl: vi.fn().mockReturnValue('/work/wt'),
      cleanupWorktreeImpl: vi.fn(),
      resolveWorktreeHeadShaImpl: vi
        .fn()
        .mockReturnValue('abc1234567890abcdef1234567890abcdef1234'),
    });

    expect(runMock).toHaveBeenCalledTimes(2);
    const secondCall = runMock.mock.calls[1][0] as { context: Record<string, unknown> };
    expect(secondCall.context.advisorFeedback).toBe('use the existing helper at X');
    expect(secondCall.context.revisionPass).toBe(1);
    expect(openPRImpl).toHaveBeenCalled();
  });

  it('priority:high — advisor abort transitions to factory:needs-human and skips PR', async () => {
    const item = makeWorkItem({ priority: 'high' });
    const source = makeStateSource();
    const runtime: AgentRuntime = {
      run: vi.fn().mockResolvedValueOnce({
        output: makeImplementOutput(),
        decisionSummaries: [],
        events: [],
      } satisfies AgentResult),
    };
    const openPRImpl = vi.fn();
    const adviseOnPlanImpl = vi.fn().mockResolvedValue({
      verdict: 'abort',
      confidence: 'high',
      reason: 'plan modifies FACTORY_RULES.md (rule 12)',
      decisionSummaries: [{ kind: 'VERDICT', summary: 'governance violation' }],
    });

    const { runFixIssueWorkflow } = await import('./workflow.js');
    await runFixIssueWorkflow(item, source, 'proj', '/repo', {
      runtime,
      openPRImpl,
      adviseOnPlanImpl,
      createWorktreeImpl: vi.fn().mockReturnValue('/work/wt'),
      cleanupWorktreeImpl: vi.fn(),
      resolveWorktreeHeadShaImpl: vi
        .fn()
        .mockReturnValue('abc1234567890abcdef1234567890abcdef1234'),
    });

    expect(openPRImpl).not.toHaveBeenCalled();
    expect(source.comment).toHaveBeenCalledWith(
      '42',
      expect.stringContaining('plan modifies FACTORY_RULES.md'),
    );
    expect(source.transitionState).toHaveBeenLastCalledWith(
      '42',
      'factory:in-progress',
      'factory:needs-human',
    );
    expect(mockAccumulatePersonaStats).toHaveBeenCalledWith({
      personaName: 'proj/developer/0',
      role: 'developer',
      outcome: 'failure',
    });
  });

  it('on implement failure: emits agent.run-failed and transitions to needs-human', async () => {
    const item = makeWorkItem({ priority: 'medium' });
    const source = makeStateSource();
    const runtime: AgentRuntime = {
      run: vi.fn().mockRejectedValueOnce(new Error('implement crashed')),
    };
    const openPRImpl = vi.fn();
    const cleanupWorktreeImpl = vi.fn();
    const resolveWorktreeHeadShaImpl = vi
      .fn()
      .mockReturnValue('abc1234567890abcdef1234567890abcdef1234');

    const { runFixIssueWorkflow } = await import('./workflow.js');
    await runFixIssueWorkflow(item, source, 'proj', '/repo', {
      runtime,
      openPRImpl,
      adviseOnPlanImpl: vi.fn(),
      createWorktreeImpl: vi.fn().mockReturnValue('/work/wt'),
      cleanupWorktreeImpl,
      resolveWorktreeHeadShaImpl,
    });

    expect(openPRImpl).not.toHaveBeenCalled();
    const failed = vi
      .mocked(eventStore.appendEvent)
      .mock.calls.find(([e]) => e.kind === 'agent.run-failed');
    expect(failed).toBeDefined();
    expect(source.transitionState).toHaveBeenLastCalledWith(
      '42',
      'factory:in-progress',
      'factory:needs-human',
    );
    expect(cleanupWorktreeImpl).toHaveBeenCalled();
    expect(mockAccumulatePersonaStats).toHaveBeenCalledWith({
      personaName: 'proj/developer/0',
      role: 'developer',
      outcome: 'failure',
    });
  });

  it('emits one agent.decision-summary per implement summary + agent.implement-complete (#206 pattern)', async () => {
    const item = makeWorkItem({ priority: 'medium' });
    const source = makeStateSource();
    const out = makeImplementOutput({
      decisionSummaries: [
        { kind: 'PLAN', summary: 'a' },
        { kind: 'RED', summary: 'b' },
        { kind: 'GREEN', summary: 'c' },
      ],
    });
    const runtime: AgentRuntime = {
      run: vi.fn().mockResolvedValueOnce({
        output: out,
        decisionSummaries: [],
        events: [],
      } satisfies AgentResult),
    };
    const openPRImpl = vi.fn().mockResolvedValue({
      prNumber: 1,
      prUrl: 'u',
      branch: 'b',
      base: 'main',
    });

    const { runFixIssueWorkflow } = await import('./workflow.js');
    await runFixIssueWorkflow(item, source, 'proj', '/repo', {
      runtime,
      openPRImpl,
      adviseOnPlanImpl: vi.fn(),
      createWorktreeImpl: vi.fn().mockReturnValue('/work/wt'),
      cleanupWorktreeImpl: vi.fn(),
      resolveWorktreeHeadShaImpl: vi
        .fn()
        .mockReturnValue('abc1234567890abcdef1234567890abcdef1234'),
    });

    const decisionEvents = vi
      .mocked(eventStore.appendEvent)
      .mock.calls.filter(
        ([e]) =>
          e.kind === 'agent.decision-summary' &&
          (e.payload as { skill?: string }).skill === 'implement',
      );
    expect(decisionEvents).toHaveLength(3);

    const completeEvent = vi
      .mocked(eventStore.appendEvent)
      .mock.calls.find(([e]) => e.kind === 'agent.implement-complete');
    expect(completeEvent).toBeDefined();
    // #467 — testsRun is preserved verbatim on agent.implement-complete so
    // QA can pull it as devTestsRun when grading.
    expect((completeEvent?.[0].payload as { testsRun: unknown }).testsRun).toEqual({
      command: 'pnpm test ',
      paths: ['core/utils/strings.test.ts'],
    });
  });
});

describe('runFixIssueWorkflow — evidence-post branch coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAccumulatePersonaStats.mockClear();
    process.env.GITHUB_TOKEN = 'ghp_test';
  });

  afterEach(() => {
    process.env.GITHUB_TOKEN = undefined;
  });

  it('with evidenceSpecPath set: runs evidence-post skill and emits evidence.posted on success', async () => {
    const item = makeWorkItem({ priority: 'medium' });
    const source = makeStateSource();

    const evidenceOutput = {
      screenshots: [{ path: 'evidence/issue-42/step-1.png', caption: 'Initial state', step: 1 }],
      gifPath: null,
      commentUrl: 'https://github.com/owner/repo/issues/42#issuecomment-1',
      commitSha: 'abc1234567890abcdef',
      decisionSummaries: [{ kind: 'COMMIT', summary: 'Posted evidence comment' }],
    };

    const runtime: AgentRuntime = {
      run: vi
        .fn()
        .mockResolvedValueOnce({
          output: makeImplementOutput({ evidenceSpecPath: 'evidence/spec.json' }),
          decisionSummaries: [],
          events: [],
        } satisfies AgentResult)
        .mockResolvedValueOnce({
          output: evidenceOutput,
          decisionSummaries: [],
          events: [],
        } satisfies AgentResult),
    };

    const openPRImpl = vi.fn().mockResolvedValue({
      prNumber: 10,
      prUrl: 'https://github.com/owner/repo/pull/10',
      branch: 'factory/abc',
      base: 'main',
    });

    const { runFixIssueWorkflow } = await import('./workflow.js');
    await runFixIssueWorkflow(item, source, 'proj', '/repo', {
      runtime,
      openPRImpl,
      adviseOnPlanImpl: vi.fn(),
      createWorktreeImpl: vi.fn().mockReturnValue('/work/wt'),
      cleanupWorktreeImpl: vi.fn(),
      resolveWorktreeHeadShaImpl: vi
        .fn()
        .mockReturnValue('abc1234567890abcdef1234567890abcdef1234'),
    });

    // Two runtime.run calls: implement + evidence-post
    expect(vi.mocked(runtime.run)).toHaveBeenCalledTimes(2);

    const evidencePosted = vi
      .mocked(eventStore.appendEvent)
      .mock.calls.find(([e]) => e.kind === 'evidence.posted');
    expect(evidencePosted).toBeDefined();
  });

  it('passes worktreePath as workspaceDir on the evidence-post run spec (so git commands work)', async () => {
    const item = makeWorkItem({ priority: 'medium' });
    const source = makeStateSource();

    const evidenceOutput = {
      screenshots: [],
      gifPath: null,
      commentUrl: 'https://github.com/owner/repo/issues/42#issuecomment-2',
      commitSha: 'abc1234567890abcdef',
      decisionSummaries: [{ kind: 'COMMIT', summary: 'Posted evidence comment' }],
    };

    const runtime: AgentRuntime = {
      run: vi
        .fn()
        .mockResolvedValueOnce({
          output: makeImplementOutput({ evidenceSpecPath: 'evidence/spec.json' }),
          decisionSummaries: [],
          events: [],
        } satisfies AgentResult)
        .mockResolvedValueOnce({
          output: evidenceOutput,
          decisionSummaries: [],
          events: [],
        } satisfies AgentResult),
    };

    const openPRImpl = vi.fn().mockResolvedValue({
      prNumber: 10,
      prUrl: 'u',
      branch: 'b',
      base: 'main',
    });

    const { runFixIssueWorkflow } = await import('./workflow.js');
    await runFixIssueWorkflow(item, source, 'proj', '/repo', {
      runtime,
      openPRImpl,
      adviseOnPlanImpl: vi.fn(),
      createWorktreeImpl: vi.fn().mockReturnValue('/work/wt'),
      cleanupWorktreeImpl: vi.fn(),
      resolveWorktreeHeadShaImpl: vi
        .fn()
        .mockReturnValue('abc1234567890abcdef1234567890abcdef1234'),
    });

    const evidenceCall = vi.mocked(runtime.run).mock.calls[1][0] as unknown as {
      workspaceDir?: string;
    };
    expect(evidenceCall.workspaceDir).toBe('/work/wt');
  });

  it('looks up the BEFORE comment URL from agent.investigation-complete and passes into evidence-post context', async () => {
    const item = makeWorkItem({ priority: 'medium', type: 'bug' });
    const source = makeStateSource();

    const evidenceOutput = {
      screenshots: [],
      gifPath: null,
      commentUrl: 'https://github.com/owner/repo/issues/42#issuecomment-2',
      commitSha: 'abc1234567890abcdef',
      decisionSummaries: [{ kind: 'COMMIT', summary: 'Posted evidence comment' }],
    };

    const runtime: AgentRuntime = {
      run: vi
        .fn()
        .mockResolvedValueOnce({
          output: makeImplementOutput({ evidenceSpecPath: 'evidence/spec.json' }),
          decisionSummaries: [],
          events: [],
        } satisfies AgentResult)
        .mockResolvedValueOnce({
          output: evidenceOutput,
          decisionSummaries: [],
          events: [],
        } satisfies AgentResult),
    };

    const beforeUrl = 'https://github.com/owner/repo/issues/42#issuecomment-1';
    vi.mocked(eventStore.replay).mockReturnValueOnce([
      {
        id: 1,
        projectId: 'proj',
        workItemId: item.id,
        kind: 'agent.investigation-complete',
        payload: { investigate: {}, playwrightRepro: { commentUrl: beforeUrl } },
        createdAt: new Date(),
        runId: 'r1',
      },
    ] as never);

    const openPRImpl = vi.fn().mockResolvedValue({
      prNumber: 10,
      prUrl: 'u',
      branch: 'b',
      base: 'main',
    });

    const { runFixIssueWorkflow } = await import('./workflow.js');
    await runFixIssueWorkflow(item, source, 'proj', '/repo', {
      runtime,
      openPRImpl,
      adviseOnPlanImpl: vi.fn(),
      createWorktreeImpl: vi.fn().mockReturnValue('/work/wt'),
      cleanupWorktreeImpl: vi.fn(),
      resolveWorktreeHeadShaImpl: vi
        .fn()
        .mockReturnValue('abc1234567890abcdef1234567890abcdef1234'),
    });

    const evidenceCall = vi.mocked(runtime.run).mock.calls[1][0] as unknown as {
      context: { workItem: { beforeCommentUrl?: string } };
      contextAllowlist: string[];
    };
    expect(evidenceCall.context.workItem.beforeCommentUrl).toBe(beforeUrl);
    expect(evidenceCall.contextAllowlist).toContain('workItem.beforeCommentUrl');
  });

  it('with evidenceSpecPath null: emits evidence.no-spec-declared and skips evidence-post run', async () => {
    const item = makeWorkItem({ priority: 'medium' });
    const source = makeStateSource();

    const runtime: AgentRuntime = {
      run: vi.fn().mockResolvedValueOnce({
        output: makeImplementOutput({ evidenceSpecPath: null }),
        decisionSummaries: [],
        events: [],
      } satisfies AgentResult),
    };

    const openPRImpl = vi.fn().mockResolvedValue({
      prNumber: 10,
      prUrl: 'https://github.com/owner/repo/pull/10',
      branch: 'factory/abc',
      base: 'main',
    });

    const { runFixIssueWorkflow } = await import('./workflow.js');
    await runFixIssueWorkflow(item, source, 'proj', '/repo', {
      runtime,
      openPRImpl,
      adviseOnPlanImpl: vi.fn(),
      createWorktreeImpl: vi.fn().mockReturnValue('/work/wt'),
      cleanupWorktreeImpl: vi.fn(),
      resolveWorktreeHeadShaImpl: vi
        .fn()
        .mockReturnValue('abc1234567890abcdef1234567890abcdef1234'),
    });

    // Only implement run — no evidence-post
    expect(vi.mocked(runtime.run)).toHaveBeenCalledTimes(1);

    const noSpec = vi
      .mocked(eventStore.appendEvent)
      .mock.calls.find(([e]) => e.kind === 'evidence.no-spec-declared');
    expect(noSpec).toBeDefined();
  });

  it('evidence-post runtime failure: emits evidence.post-failed and still transitions to needs-qa (best-effort)', async () => {
    const item = makeWorkItem({ priority: 'medium' });
    const source = makeStateSource();

    const runtime: AgentRuntime = {
      run: vi
        .fn()
        .mockResolvedValueOnce({
          output: makeImplementOutput({ evidenceSpecPath: 'evidence/spec.json' }),
          decisionSummaries: [],
          events: [],
        } satisfies AgentResult)
        .mockRejectedValueOnce(new Error('evidence-post timed out')),
    };

    const openPRImpl = vi.fn().mockResolvedValue({
      prNumber: 10,
      prUrl: 'https://github.com/owner/repo/pull/10',
      branch: 'factory/abc',
      base: 'main',
    });

    const { runFixIssueWorkflow } = await import('./workflow.js');
    await runFixIssueWorkflow(item, source, 'proj', '/repo', {
      runtime,
      openPRImpl,
      adviseOnPlanImpl: vi.fn(),
      createWorktreeImpl: vi.fn().mockReturnValue('/work/wt'),
      cleanupWorktreeImpl: vi.fn(),
      resolveWorktreeHeadShaImpl: vi
        .fn()
        .mockReturnValue('abc1234567890abcdef1234567890abcdef1234'),
    });

    // evidence-post failure is swallowed — workflow still completes
    const postFailed = vi
      .mocked(eventStore.appendEvent)
      .mock.calls.find(([e]) => e.kind === 'evidence.post-failed');
    expect(postFailed).toBeDefined();

    // Still transitions to needs-qa despite evidence-post failure
    expect(source.transitionState).toHaveBeenLastCalledWith(
      '42',
      'factory:in-progress',
      'factory:needs-qa',
    );
  });

  it('evidence-post invalid output: emits evidence.post-failed and still transitions to needs-qa', async () => {
    const item = makeWorkItem({ priority: 'medium' });
    const source = makeStateSource();

    const runtime: AgentRuntime = {
      run: vi
        .fn()
        .mockResolvedValueOnce({
          output: makeImplementOutput({ evidenceSpecPath: 'evidence/spec.json' }),
          decisionSummaries: [],
          events: [],
        } satisfies AgentResult)
        .mockResolvedValueOnce({
          // Bad output that will fail EvidencePostSchema
          output: { bad: 'data' },
          decisionSummaries: [],
          events: [],
        } satisfies AgentResult),
    };

    const openPRImpl = vi.fn().mockResolvedValue({
      prNumber: 10,
      prUrl: 'https://github.com/owner/repo/pull/10',
      branch: 'factory/abc',
      base: 'main',
    });

    const { runFixIssueWorkflow } = await import('./workflow.js');
    await runFixIssueWorkflow(item, source, 'proj', '/repo', {
      runtime,
      openPRImpl,
      adviseOnPlanImpl: vi.fn(),
      createWorktreeImpl: vi.fn().mockReturnValue('/work/wt'),
      cleanupWorktreeImpl: vi.fn(),
      resolveWorktreeHeadShaImpl: vi
        .fn()
        .mockReturnValue('abc1234567890abcdef1234567890abcdef1234'),
    });

    const postFailed = vi
      .mocked(eventStore.appendEvent)
      .mock.calls.find(([e]) => e.kind === 'evidence.post-failed');
    expect(postFailed).toBeDefined();

    expect(source.transitionState).toHaveBeenLastCalledWith(
      '42',
      'factory:in-progress',
      'factory:needs-qa',
    );
  });

  it('undefined GITHUB_TOKEN (removed from env): fails via ?? empty string fallback (line 322)', async () => {
    // Use Reflect.deleteProperty to truly remove the env key (not set to "undefined" string)
    const savedToken = process.env.GITHUB_TOKEN;
    Reflect.deleteProperty(process.env, 'GITHUB_TOKEN');
    const item = makeWorkItem({ priority: 'medium' });
    const source = makeStateSource();

    const runtime: AgentRuntime = {
      run: vi.fn().mockResolvedValueOnce({
        output: makeImplementOutput(),
        decisionSummaries: [],
        events: [],
      } satisfies AgentResult),
    };

    const openPRImpl = vi.fn();

    const { runFixIssueWorkflow } = await import('./workflow.js');
    try {
      await runFixIssueWorkflow(item, source, 'proj', '/repo', {
        runtime,
        openPRImpl,
        adviseOnPlanImpl: vi.fn(),
        createWorktreeImpl: vi.fn().mockReturnValue('/work/wt'),
        cleanupWorktreeImpl: vi.fn(),
        resolveWorktreeHeadShaImpl: vi
          .fn()
          .mockReturnValue('abc1234567890abcdef1234567890abcdef1234'),
      });
    } finally {
      if (savedToken !== undefined) process.env.GITHUB_TOKEN = savedToken;
    }

    // token = undefined ?? '' = '' → length === 0 → throws
    expect(openPRImpl).not.toHaveBeenCalled();
    expect(source.transitionState).toHaveBeenLastCalledWith(
      '42',
      'factory:in-progress',
      'factory:needs-human',
    );
  });

  it('missing GITHUB_TOKEN: fails and transitions to needs-human', async () => {
    process.env.GITHUB_TOKEN = '';
    const item = makeWorkItem({ priority: 'medium' });
    const source = makeStateSource();

    const runtime: AgentRuntime = {
      run: vi.fn().mockResolvedValueOnce({
        output: makeImplementOutput(),
        decisionSummaries: [],
        events: [],
      } satisfies AgentResult),
    };

    const openPRImpl = vi.fn();
    const cleanupWorktreeImpl = vi.fn();

    const { runFixIssueWorkflow } = await import('./workflow.js');
    await runFixIssueWorkflow(item, source, 'proj', '/repo', {
      runtime,
      openPRImpl,
      adviseOnPlanImpl: vi.fn(),
      createWorktreeImpl: vi.fn().mockReturnValue('/work/wt'),
      cleanupWorktreeImpl,
      resolveWorktreeHeadShaImpl: vi
        .fn()
        .mockReturnValue('abc1234567890abcdef1234567890abcdef1234'),
    });

    expect(openPRImpl).not.toHaveBeenCalled();
    expect(source.transitionState).toHaveBeenLastCalledWith(
      '42',
      'factory:in-progress',
      'factory:needs-human',
    );
    expect(cleanupWorktreeImpl).toHaveBeenCalled();
  });

  it('implement output validation failure: emits agent.run-failed and transitions to needs-human', async () => {
    const item = makeWorkItem({ priority: 'medium' });
    const source = makeStateSource();

    const runtime: AgentRuntime = {
      // Returns output that fails ImplementSchema validation
      run: vi.fn().mockResolvedValueOnce({
        output: { bad: 'data', missing: 'required fields' },
        decisionSummaries: [],
        events: [],
      } satisfies AgentResult),
    };

    const openPRImpl = vi.fn();

    const { runFixIssueWorkflow } = await import('./workflow.js');
    await runFixIssueWorkflow(item, source, 'proj', '/repo', {
      runtime,
      openPRImpl,
      adviseOnPlanImpl: vi.fn(),
      createWorktreeImpl: vi.fn().mockReturnValue('/work/wt'),
      cleanupWorktreeImpl: vi.fn(),
      resolveWorktreeHeadShaImpl: vi
        .fn()
        .mockReturnValue('abc1234567890abcdef1234567890abcdef1234'),
    });

    expect(openPRImpl).not.toHaveBeenCalled();
    const failed = vi
      .mocked(eventStore.appendEvent)
      .mock.calls.find(([e]) => e.kind === 'agent.run-failed');
    expect(failed).toBeDefined();
    expect(source.transitionState).toHaveBeenLastCalledWith(
      '42',
      'factory:in-progress',
      'factory:needs-human',
    );
  });

  it('PR body lists no files/tests when arrays are empty', async () => {
    const item = makeWorkItem({ priority: 'medium' });
    const source = makeStateSource();

    const runtime: AgentRuntime = {
      run: vi.fn().mockResolvedValueOnce({
        output: makeImplementOutput({ filesWritten: [], testsWritten: [] }),
        decisionSummaries: [],
        events: [],
      } satisfies AgentResult),
    };

    const openPRImpl = vi.fn().mockResolvedValue({
      prNumber: 1,
      prUrl: 'u',
      branch: 'b',
      base: 'main',
    });

    const { runFixIssueWorkflow } = await import('./workflow.js');
    await runFixIssueWorkflow(item, source, 'proj', '/repo', {
      runtime,
      openPRImpl,
      adviseOnPlanImpl: vi.fn(),
      createWorktreeImpl: vi.fn().mockReturnValue('/work/wt'),
      cleanupWorktreeImpl: vi.fn(),
      resolveWorktreeHeadShaImpl: vi
        .fn()
        .mockReturnValue('abc1234567890abcdef1234567890abcdef1234'),
    });

    const prCall = vi.mocked(openPRImpl).mock.calls[0][0];
    expect(prCall.body).toContain('_no files reported_');
    expect(prCall.body).toContain('_no tests reported_');
  });

  it('non-Error thrown (string): wraps as Error and transitions to needs-human', async () => {
    // Covers line 191: the `err instanceof Error ? err : new Error(String(err))` non-Error branch
    const item = makeWorkItem({ priority: 'medium' });
    const source = makeStateSource();

    const runtime: AgentRuntime = {
      // eslint-disable-next-line prefer-promise-reject-errors
      run: vi.fn().mockRejectedValueOnce('string error — not an Error object'),
    };

    const { runFixIssueWorkflow } = await import('./workflow.js');
    await runFixIssueWorkflow(item, source, 'proj', '/repo', {
      runtime,
      openPRImpl: vi.fn(),
      adviseOnPlanImpl: vi.fn(),
      createWorktreeImpl: vi.fn().mockReturnValue('/work/wt'),
      cleanupWorktreeImpl: vi.fn(),
      resolveWorktreeHeadShaImpl: vi
        .fn()
        .mockReturnValue('abc1234567890abcdef1234567890abcdef1234'),
    });

    // agent.run-failed should be emitted with string converted to Error message
    const failed = vi
      .mocked(eventStore.appendEvent)
      .mock.calls.find(([e]) => e.kind === 'agent.run-failed');
    expect(failed).toBeDefined();
    expect(source.transitionState).toHaveBeenLastCalledWith(
      '42',
      'factory:in-progress',
      'factory:needs-human',
    );
  });

  it('evidence-post: non-Error thrown wraps as Error (covers line 448)', async () => {
    // Covers line 448: `err instanceof Error ? err : new Error(String(err))` in runEvidencePost
    const item = makeWorkItem({ priority: 'medium' });
    const source = makeStateSource();

    const runtime: AgentRuntime = {
      run: vi
        .fn()
        .mockResolvedValueOnce({
          output: makeImplementOutput({ evidenceSpecPath: 'evidence/spec.json' }),
          decisionSummaries: [],
          events: [],
        } satisfies AgentResult)
        // evidence-post throws a non-Error (string)
        // eslint-disable-next-line prefer-promise-reject-errors
        .mockRejectedValueOnce('network timeout string'),
    };

    const openPRImpl = vi.fn().mockResolvedValue({
      prNumber: 10,
      prUrl: 'https://github.com/owner/repo/pull/10',
      branch: 'factory/abc',
      base: 'main',
    });

    const { runFixIssueWorkflow } = await import('./workflow.js');
    await runFixIssueWorkflow(item, source, 'proj', '/repo', {
      runtime,
      openPRImpl,
      adviseOnPlanImpl: vi.fn(),
      createWorktreeImpl: vi.fn().mockReturnValue('/work/wt'),
      cleanupWorktreeImpl: vi.fn(),
      resolveWorktreeHeadShaImpl: vi
        .fn()
        .mockReturnValue('abc1234567890abcdef1234567890abcdef1234'),
    });

    const postFailed = vi
      .mocked(eventStore.appendEvent)
      .mock.calls.find(([e]) => e.kind === 'evidence.post-failed');
    expect(postFailed).toBeDefined();
  });
});

describe('resolveWorktreeHeadSha (M7.bug fix — #233 SHA pinning)', () => {
  it('returns the real HEAD SHA from a git repo', async () => {
    const { execFileSync } = await import('node:child_process');
    const { mkdtempSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');

    const dir = mkdtempSync(join(tmpdir(), 'wt-sha-'));
    try {
      // Run all git commands in this throwaway fixture repo with global +
      // system config disabled so the host's commit-signing setup doesn't
      // bleed in. Signing is off; user identity is set per-call via
      // -c flags.
      const isolatedEnv = {
        ...process.env,
        GIT_CONFIG_GLOBAL: '/dev/null',
        GIT_CONFIG_SYSTEM: '/dev/null',
      };
      execFileSync('git', ['init', '-q'], { cwd: dir, env: isolatedEnv });
      execFileSync(
        'git',
        [
          '-c',
          'commit.gpgsign=false',
          '-c',
          'user.email=test@example.com',
          '-c',
          'user.name=Test',
          'commit',
          '--allow-empty',
          '-m',
          'seed',
        ],
        { cwd: dir, env: isolatedEnv },
      );

      const { resolveWorktreeHeadSha } = await import('./workflow.js');
      const sha = resolveWorktreeHeadSha(dir);

      expect(sha).toMatch(/^[0-9a-f]{40}$/);
      // Must satisfy EvidencePostSchema's >= 7 char constraint (#233 contract).
      expect(sha.length).toBeGreaterThanOrEqual(7);
      expect(sha).not.toBe('HEAD');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('falls back to "HEAD" when the path is not a git repo (loud failure path)', async () => {
    const { mkdtempSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const dir = mkdtempSync(join(tmpdir(), 'wt-sha-bad-'));
    try {
      const { resolveWorktreeHeadSha } = await import('./workflow.js');
      const sha = resolveWorktreeHeadSha(dir);
      // Fallback is intentionally invalid — fails EvidencePostSchema.prHeadSha
      // (>= 7 chars) so runEvidencePost surfaces the failure as
      // evidence.post-failed instead of silently posting a broken URL.
      expect(sha).toBe('HEAD');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
