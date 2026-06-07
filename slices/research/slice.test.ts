import type { StateSource, WorkItem } from '@goose-hub/core/state-source/interface.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockInvokeSkill = vi.fn();
const mockReconcileDecisionSummaries = vi.fn();
const mockAppendEvent = vi.fn();
const mockGetProjectBySlug = vi.fn();
const mockResolveRepositoryForWorkItem = vi.fn();
const mockResolveWorkflowBaseForWorkItem = vi.fn();
const mockTransitionAndEmitState = vi.fn();
const mockCreateWorktree = vi.fn();
const mockCleanupWorktree = vi.fn();

vi.mock('@goose-hub/core/agent-runtime/invoke-skill.js', () => ({
  invokeSkill: (...args: unknown[]) => mockInvokeSkill(...args),
}));

vi.mock('@goose-hub/core/agent-runtime/reconcile-decisions.js', () => ({
  reconcileDecisionSummaries: (...args: unknown[]) => mockReconcileDecisionSummaries(...args),
}));

vi.mock('@goose-hub/core/event-stream/store.js', () => ({
  eventStore: { appendEvent: (...args: unknown[]) => mockAppendEvent(...args) },
}));

vi.mock('@goose-hub/core/event-stream/state-transition.js', () => ({
  transitionAndEmitState: (...args: unknown[]) => mockTransitionAndEmitState(...args),
}));

vi.mock('@goose-hub/core/projects/loader.js', () => ({
  getProjectBySlug: (...args: unknown[]) => mockGetProjectBySlug(...args),
}));

vi.mock('@goose-hub/core/workspaces/repo-affinity.js', () => ({
  resolveRepositoryForWorkItem: (...args: unknown[]) => mockResolveRepositoryForWorkItem(...args),
}));

vi.mock('@goose-hub/core/workspaces/workflow-base.js', () => ({
  resolveWorkflowBaseForWorkItem: (...args: unknown[]) => mockResolveWorkflowBaseForWorkItem(...args),
}));

vi.mock('@goose-hub/core/workspaces/worktree.js', () => ({
  createWorktree: (...args: unknown[]) => mockCreateWorktree(...args),
  cleanupWorktree: (...args: unknown[]) => mockCleanupWorktree(...args),
}));

function makeWorkItem(overrides: Partial<WorkItem> = {}): WorkItem {
  return {
    id: 'github:shaunnez/goose-hub#77',
    externalId: '77',
    repoRef: 'shaunnez/goose-hub',
    title: 'Research workflow',
    body: 'How should research run?',
    type: 'research',
    priority: 'medium',
    mode: 'supervised',
    state: 'factory:research-pending',
    authorIsOwner: true,
    schedule: 'current',
    exec: 'serial',
    dependsOn: [],
    blocks: [],
    createdAt: new Date('2026-06-01T00:00:00.000Z'),
    ...overrides,
  };
}

function makeSource(): StateSource {
  return {
    projectId: 'goose-hub-self',
    repoRef: 'shaunnez/goose-hub',
    listOpenWork: vi.fn(),
    listClosedWorkByMilestone: vi.fn(),
    listWorkByMilestone: vi.fn(),
    getItem: vi.fn(),
    listMilestones: vi.fn(),
    getActiveMilestone: vi.fn(),
    transitionState: vi.fn(),
    forceState: vi.fn(),
    comment: vi.fn(),
    listComments: vi.fn(),
    setMilestone: vi.fn(),
    setLabelInGroup: vi.fn(),
    addLabels: vi.fn(),
    removeLabel: vi.fn(),
    attach: vi.fn(),
    createIssue: vi.fn(),
    createMilestone: vi.fn(),
    updateMilestone: vi.fn(),
    deleteMilestone: vi.fn(),
    getPrDiff: vi.fn(),
    watchForUpdates: vi.fn(),
  } as unknown as StateSource;
}

function makeResearchOutput() {
  return {
    summary: 'Research is distinct from investigation.',
    answer: 'Add a research workflow and server-owned routing.',
    evidence: [],
    options: [],
    followUpWork: [],
    actionability: 'advisory',
    openQuestions: ['Which follow-up should be created?'],
    decisionSummaries: [{ kind: 'PLAN', summary: 'Research artifact was synthesized.' }],
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  mockGetProjectBySlug.mockResolvedValue({ id: 'goose-hub-self', budgets: {} });
  mockResolveRepositoryForWorkItem.mockReturnValue({
    repoRef: 'shaunnez/goose-hub',
    localPath: '/repo/goose-hub',
    defaultBranch: 'main',
  });
  mockResolveWorkflowBaseForWorkItem.mockReturnValue({
    branch: 'main',
    ref: 'origin/main',
    source: 'configured-default',
  });
  mockCreateWorktree.mockReturnValue('/tmp/research-worktree');
  mockCleanupWorktree.mockReturnValue(undefined);
  mockTransitionAndEmitState.mockResolvedValue(undefined);
  mockInvokeSkill.mockResolvedValue({ output: makeResearchOutput() });
});

describe('runResearchWorkflow', () => {
  it('emits research complete, reconciles decision summaries, transitions to research-complete, and cleans up', async () => {
    const { runResearchWorkflow } = await import('./workflow.js');
    const item = makeWorkItem();
    const source = makeSource();

    const result = await runResearchWorkflow(item, source, 'goose-hub-self', '/repo/goose-hub');

    expect(result.status).toBe('success');
    expect(mockInvokeSkill).toHaveBeenCalledWith(
      expect.objectContaining({
        skillName: 'research',
        projectId: 'goose-hub-self',
        workItemId: item.id,
        context: {
          workItem: { title: item.title, body: item.body, number: 77 },
        },
      }),
    );
    expect(mockReconcileDecisionSummaries).toHaveBeenCalledWith(
      expect.stringContaining(':research'),
      'goose-hub-self',
      item.id,
      'research',
      makeResearchOutput().decisionSummaries,
    );
    expect(mockAppendEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'agent.research-complete',
        projectId: 'goose-hub-self',
        workItemId: item.id,
        payload: expect.objectContaining({ research: makeResearchOutput() }),
      }),
    );
    expect(mockTransitionAndEmitState).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'legal',
        from: 'factory:research-pending',
        to: 'factory:research-complete',
        by: 'research',
      }),
    );
    expect(mockCleanupWorktree).toHaveBeenCalledWith('/tmp/research-worktree');
  });

  it('passes scout digest context when supplied', async () => {
    const { runResearchWorkflow } = await import('./workflow.js');
    const scoutDigest = {
      reports: [],
      contradictions: [],
      skippedScouts: [],
      failedScouts: [],
    };

    await runResearchWorkflow(makeWorkItem(), makeSource(), 'goose-hub-self', '/repo/goose-hub', {
      scoutDigest: scoutDigest as never,
    });

    expect(mockInvokeSkill).toHaveBeenCalledWith(
      expect.objectContaining({
        context: expect.objectContaining({ scoutDigest }),
      }),
    );
  });

  it('emits run-failed, comments, transitions to needs-human, and cleans up on invalid skill output', async () => {
    const { runResearchWorkflow } = await import('./workflow.js');
    mockInvokeSkill.mockRejectedValue(new Error('output validation failed'));
    const source = makeSource();

    const result = await runResearchWorkflow(makeWorkItem(), source, 'goose-hub-self', '/repo');

    expect(result.status).toBe('failed');
    expect(mockAppendEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'agent.run-failed',
        payload: expect.objectContaining({ skill: 'research', error: 'output validation failed' }),
      }),
    );
    expect(source.comment).toHaveBeenCalledWith(
      '77',
      expect.stringContaining('Research failed before a valid research artifact'),
    );
    expect(mockTransitionAndEmitState).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'forced',
        to: 'factory:needs-human',
        by: 'research',
      }),
    );
    expect(mockCleanupWorktree).toHaveBeenCalledWith('/tmp/research-worktree');
  });

  it('cleans up when the transition fails after research output succeeds', async () => {
    const { runResearchWorkflow } = await import('./workflow.js');
    mockTransitionAndEmitState.mockRejectedValue(new Error('label write failed'));

    const result = await runResearchWorkflow(makeWorkItem(), makeSource(), 'goose-hub-self', '/r');

    expect(result.status).toBe('failed');
    expect(mockCleanupWorktree).toHaveBeenCalledWith('/tmp/research-worktree');
  });

  it('does not call bug investigation-only machinery', async () => {
    const { runResearchWorkflow } = await import('./workflow.js');

    await runResearchWorkflow(makeWorkItem(), makeSource(), 'goose-hub-self', '/repo/goose-hub');

    expect(mockInvokeSkill).toHaveBeenCalledWith(
      expect.objectContaining({ skillName: 'research' }),
    );
  });
});
