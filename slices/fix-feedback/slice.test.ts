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
    getPrDiff: vi.fn().mockResolvedValue(''),
    addLabels: vi.fn(),
    removeLabel: vi.fn(),
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
      worktreePath,
      devRunId: 'run-abc',
    },
    projectId: 'proj',
    workItemId: 'github:owner/repo#42',
    createdAt: new Date().toISOString(),
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
              disposition: 'fix',
              dispositionRef: 'must fix',
            },
          ],
        },
        regression: { passed: true, findings: [] },
      },
    },
    projectId: 'proj',
    workItemId: 'github:owner/repo#42',
    createdAt: new Date().toISOString(),
  };
}

describe('runFixFeedbackWorkflow', () => {
  let stateSource: StateSource;

  beforeEach(() => {
    stateSource = makeStateSource();
    vi.clearAllMocks();
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

  it('passes existing worktreePath to the runtime', async () => {
    vi.mocked(eventStore.replay).mockReturnValue([makePrOpenedEvent('/work/existing-wt')]);
    mockClaudeCliRun.mockResolvedValue({ output: makeImplementOutput() });
    const workItem = makeWorkItem();

    await runFixFeedbackWorkflow(workItem, stateSource, 'proj', 'owner/repo');

    const runCall = mockClaudeCliRun.mock.calls[0][0];
    expect(runCall.context.worktreePath).toBe('/work/existing-wt');
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
});
