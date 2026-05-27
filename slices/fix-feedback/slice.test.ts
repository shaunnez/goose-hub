import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AgentResult, AgentRuntime } from '@goose-hub/core/agent-runtime/interface.js';
import type { EventKind } from '@goose-hub/core/event-stream/store.js';
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
vi.mock('@goose-hub/core/persona/accumulate.js', () => ({
  accumulatePersonaStats: vi.fn(),
}));
vi.mock('@goose-hub/core/agent-runtime/schema-bridge.js', () => ({
  toJsonSchema: vi.fn().mockReturnValue({}),
}));
const {
  mockLatestInvestigationContext,
  mockGetChangedFilesSince,
  mockDeriveObservedChangedFiles,
  mockOrchestratorCommitAll,
  mockOrchestratorPushBranch,
} = vi.hoisted(() => ({
  mockLatestInvestigationContext: vi.fn().mockReturnValue(undefined),
  mockGetChangedFilesSince: vi.fn().mockReturnValue([]),
  mockDeriveObservedChangedFiles: vi.fn().mockReturnValue({
    count: 0,
    paths: [],
    files: [],
    gitAvailable: true,
  }),
  mockOrchestratorCommitAll: vi.fn().mockReturnValue({ status: 'committed', sha: 'repair-sha' }),
  mockOrchestratorPushBranch: vi.fn(),
}));
vi.mock('@goose-hub/core/agent-runtime/investigation-context.js', () => ({
  latestInvestigationContext: mockLatestInvestigationContext,
}));
vi.mock('@goose-hub/core/agent-runtime/git-intel.js', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@goose-hub/core/agent-runtime/git-intel.js')>();
  return { ...actual, getChangedFilesSince: mockGetChangedFilesSince };
});
vi.mock('@goose-hub/core/workspaces/observed-changes.js', () => ({
  deriveObservedChangedFiles: mockDeriveObservedChangedFiles,
}));
vi.mock('@goose-hub/core/workspaces/orchestrator-git.js', () => ({
  orchestratorCommitAll: mockOrchestratorCommitAll,
  orchestratorPushBranch: mockOrchestratorPushBranch,
}));
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return { ...actual, readFileSync: vi.fn().mockReturnValue('# mock skill prompt') };
});

const mockClaudeCliRun = vi.fn();
vi.mock('@goose-hub/core/agent-runtime/claude-cli.js', () => ({
  ClaudeCliRuntime: vi.fn().mockImplementation(() => ({ run: mockClaudeCliRun })),
}));

import { eventStore } from '@goose-hub/core/event-stream/store.js';
import { accumulatePersonaStats } from '@goose-hub/core/persona/accumulate.js';

// Import after mocks
import { runFixFeedbackWorkflow } from './workflow.js';

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
    state: 'factory:needs-fix',
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

function makeImplementOutput(overrides: Record<string, unknown> = {}) {
  return {
    plan: 'Addressed QA findings.',
    filesWritten: [{ path: 'src/utils.ts', reason: 'Fixed null check' }],
    testsWritten: [{ path: 'src/utils.test.ts', cases: 1 }],
    testsRun: { command: 'pnpm test', paths: ['src/utils.test.ts'] },
    prUrl: 'https://github.com/owner/repo/pull/1',
    evidenceSpecPath: null,
    confidence: 'high',
    decisionSummaries: [{ kind: 'FIX_STRATEGY', summary: 'Fixed null check per QA finding' }],
    ...overrides,
  };
}

function makePrOpenedEvent(worktreePath = '/work/wt', branch = 'factory/run-abc') {
  return {
    id: 1,
    kind: 'pr.opened' as EventKind,
    payload: {
      prNumber: 99,
      prUrl: 'https://github.com/owner/repo/pull/99',
      branch,
      baseBranch: 'main',
      worktreePath,
      devRunId: 'run-abc',
      pipelineRunId: 'pipe-abc',
    },
    projectId: 'proj',
    workItemId: 'github:owner/repo#42',
    createdAt: new Date().toISOString(),
    runId: 'run-abc',
  };
}

function makeQaCompletedEvent(passed = false) {
  return {
    id: 2,
    kind: 'qa.completed' as EventKind,
    payload: {
      verdict: passed ? 'pass' : 'fail',
      overallScore: passed ? 85 : 45,
      threshold: 70,
      tierResults: {
        structural: {
          passed: true,
          findings: [],
        },
        functional: {
          passed: false,
          findings: [
            {
              tier: 'functional',
              severity: 'error',
              description: 'capitalize("") returns undefined instead of ""',
              suggestion: 'Handle empty string input',
              disposition: 'needs-fix',
              dispositionRef: 'current PR',
            },
          ],
        },
        regression: { passed: true, findings: [] },
      },
    },
    projectId: 'proj',
    workItemId: 'github:owner/repo#42',
    createdAt: new Date().toISOString(),
    runId: 'qa-run-1',
  };
}

function makeToolCallEvent(
  runId: string,
  toolName: string,
  status: 'ok' | 'failed',
  path: string,
  id = 3,
) {
  return {
    id,
    kind: 'agent.tool-call' as EventKind,
    payload: {
      tool_name: toolName,
      status,
      raw_path: path,
      canonical_path: { path },
      tool_input: {
        path,
        rawPaths: [path],
        paths: [path],
      },
    },
    projectId: 'proj',
    workItemId: 'github:owner/repo#42',
    createdAt: new Date().toISOString(),
    runId,
  };
}

describe('runFixFeedbackWorkflow', () => {
  let stateSource: StateSource;

  beforeEach(() => {
    stateSource = makeStateSource();
    vi.clearAllMocks();
    mockOrchestratorCommitAll
      .mockReset()
      .mockReturnValue({ status: 'committed', sha: 'repair-sha' });
    mockOrchestratorPushBranch.mockReset();
    mockDeriveObservedChangedFiles.mockReset().mockReturnValue({
      count: 0,
      paths: [],
      files: [],
      gitAvailable: true,
    });
    vi.mocked(eventStore.appendEvent).mockReturnValue({ id: 1 } as ReturnType<
      typeof eventStore.appendEvent
    >);
  });

  it('escalates to needs-human when no pr.opened event exists', async () => {
    vi.mocked(eventStore.replay).mockReturnValue([]);
    const workItem = makeWorkItem();

    await runFixFeedbackWorkflow(workItem, stateSource, 'proj', 'owner/repo');

    expect(stateSource.transitionState).toHaveBeenCalledWith(
      '42',
      'factory:needs-fix',
      'factory:needs-human',
    );
    expect(stateSource.comment).toHaveBeenCalledWith(
      '42',
      expect.stringContaining('No worktree found'),
    );
  });

  it('transitions needs-fix → in-progress → needs-qa on success', async () => {
    vi.mocked(eventStore.replay).mockReturnValue([makePrOpenedEvent(), makeQaCompletedEvent()]);
    mockClaudeCliRun.mockResolvedValue({ output: makeImplementOutput() });
    const workItem = makeWorkItem();

    await runFixFeedbackWorkflow(workItem, stateSource, 'proj', 'owner/repo');

    expect(stateSource.transitionState).toHaveBeenNthCalledWith(
      1,
      '42',
      'factory:needs-fix',
      'factory:in-progress',
    );
    expect(stateSource.transitionState).toHaveBeenNthCalledWith(
      2,
      '42',
      'factory:in-progress',
      'factory:needs-qa',
    );
  });

  it('passes QA findings as advisorFeedback to the implement skill', async () => {
    vi.mocked(eventStore.replay).mockReturnValue([makePrOpenedEvent(), makeQaCompletedEvent()]);
    mockClaudeCliRun.mockResolvedValue({ output: makeImplementOutput() });
    const workItem = makeWorkItem();

    await runFixFeedbackWorkflow(workItem, stateSource, 'proj', 'owner/repo');

    const runCall = mockClaudeCliRun.mock.calls[0][0];
    expect(runCall.context.advisorFeedback).toContain('capitalize("") returns undefined');
  });

  it('skips implement when latest QA failure has only non-actionable out-of-scope findings', async () => {
    vi.mocked(eventStore.replay).mockReturnValue([
      makePrOpenedEvent(),
      {
        ...makeQaCompletedEvent(),
        payload: {
          verdict: 'fail',
          overallScore: 85,
          threshold: 70,
          findings: [
            {
              tier: 'functional',
              severity: 'error',
              description: 'Pre-existing loading state issue',
              disposition: 'out-of-scope',
              dispositionRef: 'Not touched by this PR',
            },
          ],
          tierResults: {
            structural: { passed: true, findings: [] },
            functional: { passed: true, findings: [] },
            regression: { passed: true, findings: [] },
          },
        },
      },
    ]);
    const workItem = makeWorkItem();

    await runFixFeedbackWorkflow(workItem, stateSource, 'proj', 'owner/repo');

    expect(mockClaudeCliRun).not.toHaveBeenCalled();
    expect(stateSource.transitionState).toHaveBeenCalledWith(
      '42',
      'factory:needs-fix',
      'factory:needs-review',
    );
    expect(vi.mocked(eventStore.appendEvent)).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'agent.fix-feedback-skipped' }),
    );
  });

  it('skips implement and escalates when QA reports deterministic verification infrastructure failure', async () => {
    vi.mocked(eventStore.replay).mockReturnValue([
      makePrOpenedEvent(),
      {
        id: 3,
        kind: 'qa.verification-blocked' as EventKind,
        payload: {
          failedTier: 2,
          reason: 'verification-harness-runtime',
          findings: ['TypeError: React.act is not a function'],
          deterministic: true,
          agentSkipped: true,
          failureCategory: 'verification-infrastructure',
        },
        projectId: 'proj',
        workItemId: 'github:owner/repo#42',
        createdAt: new Date().toISOString(),
        runId: 'qa-run-1',
      },
    ]);
    const workItem = makeWorkItem();

    await runFixFeedbackWorkflow(workItem, stateSource, 'proj', 'owner/repo');

    expect(mockClaudeCliRun).not.toHaveBeenCalled();
    expect(stateSource.transitionState).toHaveBeenCalledWith(
      '42',
      'factory:needs-fix',
      'factory:needs-human',
    );
    expect(vi.mocked(eventStore.appendEvent)).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'agent.fix-feedback-skipped',
        payload: expect.objectContaining({ reason: 'verification-infrastructure' }),
      }),
    );
  });

  it('passes existing worktreePath as runtime workspaceDir', async () => {
    vi.mocked(eventStore.replay).mockReturnValue([makePrOpenedEvent('/work/existing-wt')]);
    mockClaudeCliRun.mockResolvedValue({ output: makeImplementOutput() });
    const workItem = makeWorkItem();

    await runFixFeedbackWorkflow(workItem, stateSource, 'proj', 'owner/repo');

    const runCall = mockClaudeCliRun.mock.calls[0][0];
    expect(runCall.context.worktreePath).toBeUndefined();
    expect(runCall.workspaceDir).toBe('/work/existing-wt');
  });

  it('marks the reused implement runtime as a fix-feedback display run', async () => {
    vi.mocked(eventStore.replay).mockReturnValue([makePrOpenedEvent(), makeQaCompletedEvent()]);
    mockClaudeCliRun.mockResolvedValue({ output: makeImplementOutput() });
    const workItem = makeWorkItem();

    await runFixFeedbackWorkflow(workItem, stateSource, 'proj', 'owner/repo');

    const runCall = mockClaudeCliRun.mock.calls[0][0];
    expect(runCall.skill).toBe('implement');
    expect(runCall.extraEventPayload).toEqual({
      displaySkill: 'fix-feedback',
      workflowSkill: 'fix-feedback',
    });
  });

  it('escalates to needs-human when implement throws', async () => {
    vi.mocked(eventStore.replay).mockReturnValue([makePrOpenedEvent(), makeQaCompletedEvent()]);
    mockClaudeCliRun.mockRejectedValue(new Error('agent crashed'));
    const workItem = makeWorkItem();

    await runFixFeedbackWorkflow(workItem, stateSource, 'proj', 'owner/repo');

    expect(stateSource.transitionState).toHaveBeenLastCalledWith(
      '42',
      'factory:in-progress',
      'factory:needs-human',
    );
    expect(stateSource.comment).toHaveBeenCalledWith(
      '42',
      expect.stringContaining('agent crashed'),
    );
  });

  it('escalates to needs-human when implement output fails schema validation', async () => {
    vi.mocked(eventStore.replay).mockReturnValue([makePrOpenedEvent(), makeQaCompletedEvent()]);
    mockClaudeCliRun.mockResolvedValue({ output: { bad: 'output' } });
    const workItem = makeWorkItem();

    await runFixFeedbackWorkflow(workItem, stateSource, 'proj', 'owner/repo');

    expect(stateSource.transitionState).toHaveBeenLastCalledWith(
      '42',
      'factory:in-progress',
      'factory:needs-human',
    );
  });

  it('emits agent.fix-feedback-complete event on success', async () => {
    vi.mocked(eventStore.replay).mockReturnValue([makePrOpenedEvent(), makeQaCompletedEvent()]);
    mockClaudeCliRun.mockResolvedValue({ output: makeImplementOutput() });
    const workItem = makeWorkItem();

    await runFixFeedbackWorkflow(workItem, stateSource, 'proj', 'owner/repo');

    expect(eventStore.appendEvent).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'agent.fix-feedback-complete' }),
    );
  });

  it('escalates when written repair tests lack a post-edit run_tests success', async () => {
    const replay = vi.mocked(eventStore.replay);
    const initialEvents = [makePrOpenedEvent(), makeQaCompletedEvent()];
    replay.mockReturnValueOnce(initialEvents);
    const customRuntime: AgentRuntime = {
      run: vi.fn().mockImplementation(async (spec) => {
        replay.mockReturnValue([
          ...initialEvents,
          makeToolCallEvent(spec.runId, 'edit_file', 'ok', 'src/utils.test.ts', 3),
          makeToolCallEvent(spec.runId, 'run_tests', 'failed', 'src/utils.test.ts', 4),
        ]);
        return {
          output: makeImplementOutput({
            testsWritten: [{ path: 'src/utils.test.ts', cases: 1 }],
            testsRun: { command: 'pnpm test', paths: ['src/utils.test.ts'] },
          }),
          decisionSummaries: [],
          events: [],
        };
      }),
    };

    await runFixFeedbackWorkflow(makeWorkItem(), stateSource, 'proj', 'owner/repo', {
      runtime: customRuntime,
    });

    expect(mockOrchestratorCommitAll).not.toHaveBeenCalled();
    expect(stateSource.transitionState).toHaveBeenLastCalledWith(
      '42',
      'factory:in-progress',
      'factory:needs-human',
    );
    expect(eventStore.appendEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'agent.run-failed',
        payload: expect.objectContaining({
          failureKind: 'verification-failed',
          error: expect.stringContaining('exact-file run_tests success'),
        }),
      }),
    );
  });

  it('routes regression-unrelated QA failures to needs-human instead of issue repair', async () => {
    const workItem = makeWorkItem();
    const compareBaseline = vi.fn().mockResolvedValue({
      status: 'same-failures-on-base',
      feedback: 'Baseline comparison: same failures on origin/main',
    });
    vi.mocked(eventStore.replay).mockReturnValue([
      makePrOpenedEvent(),
      {
        ...makeQaCompletedEvent(false),
        payload: {
          verdict: 'fail',
          overallScore: 40,
          threshold: 70,
          failureCategory: 'regression-unrelated',
          tierResults: {
            structural: { passed: true, findings: [] },
            functional: { passed: true, findings: [] },
            regression: {
              passed: false,
              findings: [
                {
                  tier: 'regression',
                  severity: 'error',
                  description: 'Global e2e seed fails on base',
                  suggestion: 'Fix pipeline seed data',
                },
              ],
            },
          },
        },
      },
    ]);

    await runFixFeedbackWorkflow(workItem, stateSource, 'proj', 'owner/repo', {
      baselineRegressionComparisonImpl: compareBaseline,
    });

    expect(compareBaseline).toHaveBeenCalledWith(
      expect.objectContaining({
        worktreePath: '/work/wt',
        baseBranch: 'main',
      }),
    );
    expect(mockClaudeCliRun).not.toHaveBeenCalled();
    expect(stateSource.transitionState).toHaveBeenCalledWith(
      '42',
      'factory:needs-fix',
      'factory:needs-human',
    );
    expect(eventStore.appendEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'agent.fix-feedback-skipped',
        payload: expect.objectContaining({
          reason: 'baseline-red-global',
          sourceFeedback: expect.stringContaining('regression suite failed'),
        }),
      }),
    );
  });

  it('skips prompt-contract regression failures without launching repair', async () => {
    const workItem = makeWorkItem();
    const compareBaseline = vi.fn();
    vi.mocked(eventStore.replay).mockReturnValue([
      makePrOpenedEvent(),
      {
        ...makeQaCompletedEvent(false),
        payload: {
          verdict: 'fail',
          overallScore: 0,
          threshold: 70,
          deterministic: true,
          agentSkipped: true,
          failureCategory: 'regression-unrelated',
          tierResults: {
            structural: { passed: true, findings: [] },
            functional: { passed: true, findings: [] },
            regression: {
              passed: false,
              command: 'pnpm test',
              findings: [
                {
                  tier: 'regression',
                  severity: 'error',
                  description:
                    'Regression [escalate]: FAIL skills/implement/slice.test.ts > implement prompt > bounds frontend evidence discovery when e2e support is missing or unclear',
                  suggestion: 'Update brittle prompt contract assertion.',
                },
              ],
            },
          },
        },
      },
    ]);

    await runFixFeedbackWorkflow(workItem, stateSource, 'proj', 'owner/repo', {
      baselineRegressionComparisonImpl: compareBaseline,
    });

    expect(compareBaseline).not.toHaveBeenCalled();
    expect(mockClaudeCliRun).not.toHaveBeenCalled();
    expect(stateSource.transitionState).toHaveBeenCalledWith(
      '42',
      'factory:needs-fix',
      'factory:needs-human',
    );
    expect(eventStore.appendEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'agent.fix-feedback-skipped',
        payload: expect.objectContaining({
          reason: 'prompt-contract-regression',
          sourceFeedback: expect.stringContaining('prompt-contract'),
        }),
      }),
    );
  });

  it('repairs regression-unrelated QA failures when baseline comparison is head-only', async () => {
    const workItem = makeWorkItem();
    const compareBaseline = vi.fn().mockResolvedValue({
      status: 'head-only-failure',
      feedback: 'Baseline comparison: regression passed on origin/main',
    });
    vi.mocked(eventStore.replay).mockReturnValue([
      makePrOpenedEvent(),
      {
        ...makeQaCompletedEvent(false),
        payload: {
          verdict: 'fail',
          overallScore: 40,
          threshold: 70,
          failureCategory: 'regression-unrelated',
          tierResults: {
            structural: { passed: true, findings: [] },
            functional: { passed: true, findings: [] },
            regression: {
              passed: false,
              findings: [
                {
                  tier: 'regression',
                  severity: 'error',
                  description: 'Regression [escalate]: failing head-only suite',
                  suggestion: 'Repair the regression',
                },
              ],
            },
          },
        },
      },
    ]);
    mockClaudeCliRun.mockResolvedValue({ output: makeImplementOutput() });

    await runFixFeedbackWorkflow(workItem, stateSource, 'proj', 'owner/repo', {
      baselineRegressionComparisonImpl: compareBaseline,
    });

    expect(mockClaudeCliRun).toHaveBeenCalledWith(
      expect.objectContaining({
        context: expect.objectContaining({
          advisorFeedback: expect.stringContaining('head-only'),
        }),
      }),
    );
    expect(stateSource.transitionState).toHaveBeenNthCalledWith(
      1,
      '42',
      'factory:needs-fix',
      'factory:in-progress',
    );
  });

  it('commits repair edits and pushes the existing PR branch before completion', async () => {
    mockDeriveObservedChangedFiles.mockReturnValue({
      count: 2,
      paths: ['src/utils.ts', 'src/utils.test.ts'],
      files: [],
      gitAvailable: true,
    });
    vi.mocked(eventStore.replay).mockReturnValue([
      makePrOpenedEvent('/work/existing-wt', 'factory/existing-pr'),
      makeQaCompletedEvent(),
    ]);
    mockClaudeCliRun.mockResolvedValue({ output: makeImplementOutput() });

    await runFixFeedbackWorkflow(makeWorkItem(), stateSource, 'proj', 'owner/repo');

    expect(mockDeriveObservedChangedFiles).toHaveBeenCalledWith('/work/existing-wt');
    expect(mockOrchestratorCommitAll).toHaveBeenCalledWith(
      '/work/existing-wt',
      'fix(#42): address feedback cycle 1',
    );
    expect(mockOrchestratorPushBranch).toHaveBeenCalledWith(
      '/work/existing-wt',
      'factory/existing-pr',
    );

    const completeEvent = vi
      .mocked(eventStore.appendEvent)
      .mock.calls.find(([event]) => event.kind === 'agent.fix-feedback-complete')?.[0];
    const completeEventCallIndex = vi
      .mocked(eventStore.appendEvent)
      .mock.calls.findIndex(([event]) => event.kind === 'agent.fix-feedback-complete');
    expect(mockOrchestratorPushBranch.mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(eventStore.appendEvent).mock.invocationCallOrder[completeEventCallIndex],
    );
    expect(completeEvent?.payload).toEqual(
      expect.objectContaining({
        commitSha: 'repair-sha',
        branch: 'factory/existing-pr',
        baseBranch: 'main',
        branchSource: 'pr.opened',
        observedChangedFiles: {
          count: 2,
          paths: ['src/utils.ts', 'src/utils.test.ts'],
        },
      }),
    );
  });

  it('falls back to the factory dev branch when legacy pr.opened lacks branch', async () => {
    const prOpened = makePrOpenedEvent('/work/existing-wt');
    (prOpened.payload as { branch?: string }).branch = undefined;
    vi.mocked(eventStore.replay).mockReturnValue([prOpened, makeQaCompletedEvent()]);
    mockClaudeCliRun.mockResolvedValue({ output: makeImplementOutput() });

    await runFixFeedbackWorkflow(makeWorkItem(), stateSource, 'proj', 'owner/repo');

    expect(mockOrchestratorPushBranch).toHaveBeenCalledWith('/work/existing-wt', 'factory/run-abc');
    const completeEvent = vi
      .mocked(eventStore.appendEvent)
      .mock.calls.find(([event]) => event.kind === 'agent.fix-feedback-complete')?.[0];
    expect(completeEvent?.payload).toEqual(
      expect.objectContaining({
        branch: 'factory/run-abc',
        branchSource: 'fallback',
      }),
    );
  });

  it('carries legacy repair lifecycle metadata on completion and state transitions', async () => {
    vi.mocked(eventStore.replay).mockReturnValue([makePrOpenedEvent(), makeQaCompletedEvent()]);
    mockClaudeCliRun.mockResolvedValue({ output: makeImplementOutput() });
    const workItem = makeWorkItem();

    await runFixFeedbackWorkflow(workItem, stateSource, 'proj', 'owner/repo');

    const completeEvent = vi
      .mocked(eventStore.appendEvent)
      .mock.calls.find(([event]) => event.kind === 'agent.fix-feedback-complete')?.[0];
    expect(completeEvent?.payload).toEqual(
      expect.objectContaining({
        pipelineRunId: 'pipe-abc',
        repairMode: 'legacy-implement',
        repairCycle: 1,
        sourceFailureKind: 'qa',
        sourceFailureRunId: 'qa-run-1',
        worktreePath: '/work/wt',
        prNumber: 99,
        devRunId: 'run-abc',
      }),
    );
    expect((completeEvent?.payload as { attemptId?: unknown }).attemptId).toEqual(
      expect.any(String),
    );

    const transitionEvents = vi
      .mocked(eventStore.appendEvent)
      .mock.calls.map(([event]) => event)
      .filter((event) => event.kind === 'state.transitioned');
    expect(transitionEvents).toHaveLength(2);
    expect(transitionEvents[0].payload).toEqual(
      expect.objectContaining({
        to: 'factory:in-progress',
        pipelineRunId: 'pipe-abc',
        repairMode: 'legacy-implement',
        repairCycle: 1,
      }),
    );
    expect(transitionEvents[1].payload).toEqual(
      expect.objectContaining({
        to: 'factory:needs-qa',
        pipelineRunId: 'pipe-abc',
        repairMode: 'legacy-implement',
        repairCycle: 1,
      }),
    );
  });

  it('increments repairCycle from prior fix-feedback completions', async () => {
    vi.mocked(eventStore.replay).mockReturnValue([
      makePrOpenedEvent(),
      makeQaCompletedEvent(),
      {
        id: 3,
        kind: 'agent.fix-feedback-complete' as EventKind,
        payload: { repairMode: 'legacy-implement', repairCycle: 1 },
        projectId: 'proj',
        workItemId: 'github:owner/repo#42',
        createdAt: new Date().toISOString(),
      },
    ]);
    mockClaudeCliRun.mockResolvedValue({ output: makeImplementOutput() });
    const workItem = makeWorkItem();

    await runFixFeedbackWorkflow(workItem, stateSource, 'proj', 'owner/repo');

    const completeEvent = vi
      .mocked(eventStore.appendEvent)
      .mock.calls.find(([event]) => event.kind === 'agent.fix-feedback-complete')?.[0];
    expect(completeEvent?.payload).toEqual(expect.objectContaining({ repairCycle: 2 }));
  });

  it('works with custom runtime dep injection', async () => {
    vi.mocked(eventStore.replay).mockReturnValue([makePrOpenedEvent()]);
    const customRun = vi.fn().mockResolvedValue({ output: makeImplementOutput() });
    const customRuntime: AgentRuntime = { run: customRun };
    const workItem = makeWorkItem();

    await runFixFeedbackWorkflow(workItem, stateSource, 'proj', 'owner/repo', {
      runtime: customRuntime,
    });

    expect(customRun).toHaveBeenCalledOnce();
  });

  describe('prior context inheritance', () => {
    function makeDecisionSummaryEvent(runId: string, kind: string, summary: string, id = 4) {
      return {
        id,
        kind: 'agent.decision-summary' as EventKind,
        payload: { runId, kind, summary, evidence: 'should-not-leak' },
        projectId: 'proj',
        workItemId: 'github:owner/repo#42',
        createdAt: new Date().toISOString(),
        runId,
      };
    }

    beforeEach(() => {
      mockLatestInvestigationContext.mockReset().mockReturnValue(undefined);
      mockGetChangedFilesSince.mockReset().mockReturnValue([]);
    });

    it('injects prior investigation findings + keyFiles into implement context', async () => {
      mockLatestInvestigationContext.mockReturnValue({
        findings: 'Reset state on close',
        keyFiles: [
          { path: 'apps/web/src/components/chat/ChatDock.tsx' },
          { path: 'apps/web/src/components/chat/ChatPanel.tsx' },
        ],
        openQuestions: ['Should close clear persisted id?'],
        investigationRunId: 'investigation-1',
      });
      vi.mocked(eventStore.replay).mockReturnValue([makePrOpenedEvent(), makeQaCompletedEvent()]);
      mockClaudeCliRun.mockResolvedValue({ output: makeImplementOutput() });

      await runFixFeedbackWorkflow(makeWorkItem(), stateSource, 'proj', 'owner/repo');

      const runCall = mockClaudeCliRun.mock.calls[0][0];
      expect(runCall.context.priorInvestigation).toMatchObject({
        findings: 'Reset state on close',
        keyFiles: [
          'apps/web/src/components/chat/ChatDock.tsx',
          'apps/web/src/components/chat/ChatPanel.tsx',
        ],
        openQuestions: ['Should close clear persisted id?'],
      });
      expect(runCall.contextAllowlist).toEqual(
        expect.arrayContaining([
          'priorInvestigation.findings',
          'priorInvestigation.keyFiles',
          'priorInvestigation.openQuestions',
        ]),
      );
    });

    it('injects prior dev decisionSummaries (kind+summary only, no evidence)', async () => {
      vi.mocked(eventStore.replay).mockReturnValue([
        makePrOpenedEvent(),
        makeQaCompletedEvent(),
        makeDecisionSummaryEvent('run-abc', 'PLAN', 'Patch ChatPanel onClose'),
        makeDecisionSummaryEvent('run-abc', 'RED', 'Added close/reopen regression test', 5),
        makeDecisionSummaryEvent(
          'run-abc:wp:WP1:iter:0',
          'IMPLEMENTATION_PLAN',
          'WP1 changed the chat surface files',
          7,
        ),
        makeDecisionSummaryEvent('run-other', 'PLAN', 'Should NOT be included', 6),
      ]);
      mockClaudeCliRun.mockResolvedValue({ output: makeImplementOutput() });

      await runFixFeedbackWorkflow(makeWorkItem(), stateSource, 'proj', 'owner/repo');

      const runCall = mockClaudeCliRun.mock.calls[0][0];
      expect(runCall.context.priorDevDecisions).toEqual([
        { kind: 'PLAN', summary: 'Patch ChatPanel onClose' },
        { kind: 'RED', summary: 'Added close/reopen regression test' },
        { kind: 'IMPLEMENTATION_PLAN', summary: 'WP1 changed the chat surface files' },
      ]);
      expect(JSON.stringify(runCall.context.priorDevDecisions)).not.toContain('should-not-leak');
      expect(JSON.stringify(runCall.context.priorDevDecisions)).not.toContain(
        'Should NOT be included',
      );
      expect(runCall.contextAllowlist).toContain('priorDevDecisions');
    });

    it('injects prior dev changed files into implement context', async () => {
      mockGetChangedFilesSince.mockReturnValue([
        'apps/web/src/components/chat/ChatDock.tsx',
        'apps/web/src/components/chat/ChatPanel.tsx',
      ]);
      vi.mocked(eventStore.replay).mockReturnValue([makePrOpenedEvent(), makeQaCompletedEvent()]);
      mockClaudeCliRun.mockResolvedValue({ output: makeImplementOutput() });

      await runFixFeedbackWorkflow(makeWorkItem(), stateSource, 'proj', 'owner/repo');

      const runCall = mockClaudeCliRun.mock.calls[0][0];
      expect(runCall.context.priorDevChangedFiles).toEqual([
        'apps/web/src/components/chat/ChatDock.tsx',
        'apps/web/src/components/chat/ChatPanel.tsx',
      ]);
      expect(runCall.contextAllowlist).toContain('priorDevChangedFiles');
    });

    it('emits agent.investigation-context-injected for the fix-feedback run when context exists', async () => {
      mockLatestInvestigationContext.mockReturnValue({
        findings: 'Reset on close',
        keyFiles: [{ path: 'apps/web/src/components/chat/ChatDock.tsx' }],
        openQuestions: [],
        investigationRunId: 'investigation-1',
      });
      mockGetChangedFilesSince.mockReturnValue(['apps/web/src/components/chat/ChatDock.tsx']);
      vi.mocked(eventStore.replay).mockReturnValue([makePrOpenedEvent(), makeQaCompletedEvent()]);
      mockClaudeCliRun.mockResolvedValue({ output: makeImplementOutput() });

      await runFixFeedbackWorkflow(makeWorkItem(), stateSource, 'proj', 'owner/repo');

      const injectionEvent = vi
        .mocked(eventStore.appendEvent)
        .mock.calls.map(([event]) => event)
        .find((event) => event.kind === 'agent.investigation-context-injected');
      expect(injectionEvent).toBeDefined();
      expect(injectionEvent?.payload).toMatchObject({
        skill: 'fix-feedback',
        investigationRunId: 'investigation-1',
        keyFileCount: 1,
        priorDevChangedFileCount: 1,
      });
    });

    it('covers the G1 G2 G3 cascade together in a fix-feedback run', async () => {
      const evidenceSpecPath = 'apps/web/e2e/issue-X.spec.ts';
      const worktreePath = process.cwd();
      const investigationEvent = {
        id: 4,
        kind: 'agent.investigation-complete' as EventKind,
        payload: {
          investigate: {
            findings: 'Keep task detail view stable after repair',
            keyFiles: [
              { path: 'apps/web/src/components/detail/components/DetailPage.tsx' },
              { path: 'apps/web/src/components/detail/components/CommentsSection.tsx' },
            ],
            openQuestions: ['Can the existing issue spec be reused?'],
          },
          investigationRunId: 'investigation-1',
        },
        projectId: 'proj',
        workItemId: 'github:owner/repo#42',
        createdAt: new Date().toISOString(),
        runId: 'investigation-1',
      };
      const workflowEvents = [
        makePrOpenedEvent(worktreePath),
        makeQaCompletedEvent(),
        {
          id: 3,
          kind: 'agent.implement-complete' as EventKind,
          payload: { evidenceSpecPath },
          projectId: 'proj',
          workItemId: 'github:owner/repo#42',
          createdAt: new Date().toISOString(),
          runId: 'run-abc',
        },
      ];
      const { latestInvestigationContext: actualLatestInvestigationContext } =
        await vi.importActual<
          typeof import('@goose-hub/core/agent-runtime/investigation-context.js')
        >('@goose-hub/core/agent-runtime/investigation-context.js');
      const { appendRuntimeAdvisoryEvent } = await vi.importActual<
        typeof import('@goose-hub/core/agent-runtime/codex-cli.js')
      >('@goose-hub/core/agent-runtime/codex-cli.js');
      mockLatestInvestigationContext.mockImplementation(actualLatestInvestigationContext);
      vi.mocked(eventStore.replay).mockImplementation((query) => {
        if (query?.kind === 'agent.investigation-complete') {
          return [investigationEvent];
        }
        return workflowEvents;
      });
      mockGetChangedFilesSince.mockReturnValue([
        'apps/web/src/components/detail/components/DetailPage.tsx',
        'apps/web/src/components/detail/components/CommentsSection.tsx',
      ]);
      const customRun = vi.fn().mockImplementation(async (spec) => {
        appendRuntimeAdvisoryEvent({
          line: 'resources/read failed: resources/read?path=foo.ts transient stderr',
          projectId: 'proj',
          workItemId: 'github:owner/repo#42',
          runId: spec.runId,
          personaId: spec.personaId,
          skill: spec.skill,
        });
        return {
          output: makeImplementOutput({ evidenceSpecPath }),
          decisionSummaries: [],
          events: [],
        };
      });
      const customRuntime: AgentRuntime = { run: customRun };

      await runFixFeedbackWorkflow(makeWorkItem(), stateSource, 'proj', 'owner/repo', {
        runtime: customRuntime,
      });

      const runCall = customRun.mock.calls[0][0];
      expect(runCall.context.priorEvidenceSpecPath).toBe(evidenceSpecPath);
      expect(runCall.context.existingFileManifest).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: expect.stringContaining('apps/web/src/components/detail/components/'),
            kind: 'file',
          }),
        ]),
      );
      expect(runCall.context.existingFileManifest).not.toHaveLength(0);
      expect(runCall.contextAllowlist).toEqual(
        expect.arrayContaining(['priorEvidenceSpecPath', 'existingFileManifest']),
      );

      const appendedEvents = vi.mocked(eventStore.appendEvent).mock.calls.map(([event]) => event);
      expect(appendedEvents).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            kind: 'agent.runtime-advisory',
            payload: expect.objectContaining({
              surface: 'resources/read failed',
              stderr: expect.stringContaining('resources/read?path=foo.ts'),
            }),
          }),
          expect.objectContaining({ kind: 'agent.fix-feedback-complete' }),
        ]),
      );
      expect(appendedEvents).not.toEqual(
        expect.arrayContaining([expect.objectContaining({ kind: 'agent.run-blocked' })]),
      );
    });

    it('uses the shared capped manifest collector for fix-feedback existingFileManifest', async () => {
      const worktreePath = mkdtempSync(join(tmpdir(), 'fix-feedback-manifest-'));
      try {
        const scopeRoot = join(worktreePath, 'apps/web/src/components/detail');
        mkdirSync(join(scopeRoot, 'node_modules/pkg'), { recursive: true });
        writeFileSync(join(scopeRoot, 'AAnchor.tsx'), 'export const AAnchor = () => null;\n');
        writeFileSync(
          join(scopeRoot, 'node_modules/pkg/index.ts'),
          'export const ignored = true;\n',
        );
        for (let i = 0; i < 820; i++) {
          writeFileSync(join(scopeRoot, `Generated${i}.tsx`), 'export const x = 1;\n');
        }

        mockLatestInvestigationContext.mockReturnValue({
          findings: 'Repair detail surface.',
          keyFiles: [{ path: 'apps/web/src/components/detail/AAnchor.tsx' }],
          openQuestions: [],
          investigationRunId: 'investigation-1',
        });
        vi.mocked(eventStore.replay).mockReturnValue([
          makePrOpenedEvent(worktreePath),
          makeQaCompletedEvent(),
        ]);

        const customRun = vi.fn().mockResolvedValue({
          output: makeImplementOutput(),
          decisionSummaries: [],
          events: [],
        });
        const customRuntime: AgentRuntime = { run: customRun };

        await runFixFeedbackWorkflow(makeWorkItem(), stateSource, 'proj', 'owner/repo', {
          runtime: customRuntime,
        });

        const manifest = customRun.mock.calls[0][0].context.existingFileManifest as Array<{
          path: string;
          kind: 'file' | 'dir';
        }>;
        expect(manifest.length).toBeLessThanOrEqual(800);
        expect(manifest).toEqual(
          expect.arrayContaining([
            { path: 'apps/web/src/components/detail', kind: 'dir' },
            { path: 'apps/web/src/components/detail/AAnchor.tsx', kind: 'file' },
          ]),
        );
        expect(manifest.some((entry) => entry.path.includes('node_modules'))).toBe(false);
      } finally {
        rmSync(worktreePath, { recursive: true, force: true });
      }
    });

    it('omits priorInvestigation when none recorded', async () => {
      vi.mocked(eventStore.replay).mockReturnValue([makePrOpenedEvent(), makeQaCompletedEvent()]);
      mockClaudeCliRun.mockResolvedValue({ output: makeImplementOutput() });

      await runFixFeedbackWorkflow(makeWorkItem(), stateSource, 'proj', 'owner/repo');

      const runCall = mockClaudeCliRun.mock.calls[0][0];
      expect(runCall.context.priorInvestigation).toBeUndefined();
    });
  });

  describe('priorEvidenceSpecPath forwarding', () => {
    it('forwards priorEvidenceSpecPath from the most recent implement-complete event', async () => {
      vi.mocked(eventStore.replay).mockReturnValue([
        makePrOpenedEvent(),
        makeQaCompletedEvent(),
        {
          id: 5,
          kind: 'agent.implement-complete' as EventKind,
          payload: { runId: 'dev-1', evidenceSpecPath: 'apps/web/e2e/issue-123.spec.ts' },
          projectId: 'proj',
          workItemId: 'github:owner/repo#42',
          createdAt: new Date().toISOString(),
          runId: 'dev-1',
        },
      ]);
      mockClaudeCliRun.mockResolvedValue({ output: makeImplementOutput() });
      const workItem = makeWorkItem();

      await runFixFeedbackWorkflow(workItem, stateSource, 'proj', 'owner/repo');

      const runCall = mockClaudeCliRun.mock.calls[0][0];
      expect(runCall.context.priorEvidenceSpecPath).toBe('apps/web/e2e/issue-123.spec.ts');
      expect(runCall.contextAllowlist).toContain('priorEvidenceSpecPath');
    });

    it('forwards priorEvidenceSpecPath from the most recent fix-feedback-complete event', async () => {
      vi.mocked(eventStore.replay).mockReturnValue([
        makePrOpenedEvent(),
        makeQaCompletedEvent(),
        {
          id: 5,
          kind: 'agent.fix-feedback-complete' as EventKind,
          payload: { repairCycle: 1, evidenceSpecPath: 'apps/web/e2e/issue-123.spec.ts' },
          projectId: 'proj',
          workItemId: 'github:owner/repo#42',
          createdAt: new Date().toISOString(),
          runId: 'fix-1',
        },
      ]);
      mockClaudeCliRun.mockResolvedValue({ output: makeImplementOutput() });

      await runFixFeedbackWorkflow(makeWorkItem(), stateSource, 'proj', 'owner/repo');

      const runCall = mockClaudeCliRun.mock.calls[0][0];
      expect(runCall.context.priorEvidenceSpecPath).toBe('apps/web/e2e/issue-123.spec.ts');
    });

    it('picks the most recent evidenceSpecPath when multiple events exist', async () => {
      vi.mocked(eventStore.replay).mockReturnValue([
        makePrOpenedEvent(),
        {
          id: 4,
          kind: 'agent.implement-complete' as EventKind,
          payload: { runId: 'dev-1', evidenceSpecPath: 'apps/web/e2e/old.spec.ts' },
          projectId: 'proj',
          workItemId: 'github:owner/repo#42',
          createdAt: new Date(Date.now() - 60_000).toISOString(),
          runId: 'dev-1',
        },
        makeQaCompletedEvent(),
        {
          id: 6,
          kind: 'agent.fix-feedback-complete' as EventKind,
          payload: { repairCycle: 1, evidenceSpecPath: 'apps/web/e2e/new.spec.ts' },
          projectId: 'proj',
          workItemId: 'github:owner/repo#42',
          createdAt: new Date().toISOString(),
          runId: 'fix-1',
        },
      ]);
      mockClaudeCliRun.mockResolvedValue({ output: makeImplementOutput() });

      await runFixFeedbackWorkflow(makeWorkItem(), stateSource, 'proj', 'owner/repo');

      const runCall = mockClaudeCliRun.mock.calls[0][0];
      expect(runCall.context.priorEvidenceSpecPath).toBe('apps/web/e2e/new.spec.ts');
    });

    it('treats null evidenceSpecPath on the most recent completion as authoritative', async () => {
      vi.mocked(eventStore.replay).mockReturnValue([
        makePrOpenedEvent(),
        {
          id: 4,
          kind: 'agent.implement-complete' as EventKind,
          payload: { runId: 'dev-1', evidenceSpecPath: 'apps/web/e2e/old.spec.ts' },
          projectId: 'proj',
          workItemId: 'github:owner/repo#42',
          createdAt: new Date(Date.now() - 60_000).toISOString(),
          runId: 'dev-1',
        },
        makeQaCompletedEvent(),
        {
          id: 6,
          kind: 'agent.fix-feedback-complete' as EventKind,
          payload: { repairCycle: 1, evidenceSpecPath: null },
          projectId: 'proj',
          workItemId: 'github:owner/repo#42',
          createdAt: new Date().toISOString(),
          runId: 'fix-1',
        },
      ]);
      mockClaudeCliRun.mockResolvedValue({ output: makeImplementOutput() });

      await runFixFeedbackWorkflow(makeWorkItem(), stateSource, 'proj', 'owner/repo');

      const runCall = mockClaudeCliRun.mock.calls[0][0];
      expect(runCall.context.priorEvidenceSpecPath).toBeUndefined();
    });

    it('omits priorEvidenceSpecPath when no relevant event exists', async () => {
      vi.mocked(eventStore.replay).mockReturnValue([makePrOpenedEvent(), makeQaCompletedEvent()]);
      mockClaudeCliRun.mockResolvedValue({ output: makeImplementOutput() });

      await runFixFeedbackWorkflow(makeWorkItem(), stateSource, 'proj', 'owner/repo');

      const runCall = mockClaudeCliRun.mock.calls[0][0];
      expect(runCall.context.priorEvidenceSpecPath).toBeUndefined();
    });

    it('includes evidenceSpecPath in agent.fix-feedback-complete payload', async () => {
      vi.mocked(eventStore.replay).mockReturnValue([makePrOpenedEvent(), makeQaCompletedEvent()]);
      mockClaudeCliRun.mockResolvedValue({
        output: makeImplementOutput({ evidenceSpecPath: 'apps/web/e2e/issue-42.spec.ts' }),
      });

      await runFixFeedbackWorkflow(makeWorkItem(), stateSource, 'proj', 'owner/repo');

      const completeEvent = vi
        .mocked(eventStore.appendEvent)
        .mock.calls.find(([event]) => event.kind === 'agent.fix-feedback-complete')?.[0];
      expect((completeEvent?.payload as { evidenceSpecPath?: unknown }).evidenceSpecPath).toBe(
        'apps/web/e2e/issue-42.spec.ts',
      );
    });
  });
});
