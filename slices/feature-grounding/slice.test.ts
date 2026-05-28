import type { StateSource, WorkItem } from '@goose-hub/core/state-source/interface.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockDispatchWave = vi.fn();
const mockPersistScoutReportForRun = vi.fn();
const mockAppendEvent = vi.fn();
const mockReplay = vi.fn();
const mockTransitionAndEmitState = vi.fn();

vi.mock('@goose-hub/core/agent-runtime/swarm.js', () => ({
  dispatchWave: (...args: unknown[]) => mockDispatchWave(...args),
}));

vi.mock('@goose-hub/core/scout-reports/repository.js', () => ({
  persistScoutReportForRun: (...args: unknown[]) => mockPersistScoutReportForRun(...args),
}));

vi.mock('@goose-hub/core/event-stream/store.js', () => ({
  eventStore: {
    appendEvent: (...args: unknown[]) => mockAppendEvent(...args),
    replay: (...args: unknown[]) => mockReplay(...args),
  },
}));

vi.mock('@goose-hub/core/event-stream/state-transition.js', () => ({
  transitionAndEmitState: (...args: unknown[]) => mockTransitionAndEmitState(...args),
}));

vi.mock('@goose-hub/core/projects/loader.js', () => ({
  getProjectBySlug: vi.fn().mockResolvedValue({
    id: 'goose-hub-self',
    targetRepo: { defaultBranch: 'main' },
    budgets: { maxParallelAgents: 4 },
    investigationSwarm: { enabled: true },
    agentConfig: { runtime: 'auto' },
  }),
}));

vi.mock('@goose-hub/core/agent-runtime/select-persona.js', () => ({
  selectPersona: vi.fn().mockReturnValue({ personaId: 'investigator-test' }),
}));

vi.mock('@goose-hub/core/agent-runtime/select-runtime.js', () => ({
  selectRuntime: vi.fn().mockReturnValue({ run: vi.fn() }),
}));

vi.mock('@goose-hub/core/agent-runtime/read-prompt.js', () => ({
  readPromptWithContext: vi.fn().mockReturnValue('# scout prompt'),
}));

vi.mock('@goose-hub/core/db/repositories/project-settings.js', () => ({
  getUseInvestigationSwarm: vi.fn().mockReturnValue(true),
}));

vi.mock('@goose-hub/core/agent-runtime/skill-runtime-resolver.js', () => ({
  resolveSkillRuntimeForProject: vi.fn().mockReturnValue({
    modelOverride: 'claude-3-5-sonnet-latest',
    provider: 'claude',
    budgets: { timeoutMs: 30_000 },
  }),
}));

vi.mock('@goose-hub/core/workspaces/workflow-base.js', () => ({
  resolveWorkflowBaseForWorkItem: vi.fn().mockReturnValue({
    branch: 'main',
    ref: 'origin/main',
    source: 'configured-default',
  }),
}));

function makeWorkItem(): WorkItem {
  return {
    id: 'github:shaunnez/goose-hub#1176',
    externalId: '1176',
    repoRef: 'shaunnez/goose-hub',
    title: 'Add workflow snapshot costs',
    body: 'Show cost cards on the detail page.',
    type: 'feature',
    priority: 'medium',
    mode: 'supervised',
    state: 'factory:grounding',
    authorIsOwner: true,
    schedule: 'current',
    exec: 'serial',
    dependsOn: [],
    blocks: [],
    createdAt: new Date(),
  };
}

function makeSource(): StateSource {
  return {
    projectId: 'goose-hub-self',
    repoRef: 'shaunnez/goose-hub',
    transitionState: vi.fn(),
    forceState: vi.fn(),
    comment: vi.fn(),
  } as unknown as StateSource;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockReplay.mockReturnValue([]);
  mockDispatchWave.mockResolvedValue({
    status: 'ok',
    shouldAdvance: true,
    shouldEscalate: false,
    failedScouts: [],
    skippedScouts: [],
    okCount: 2,
    applicableCount: 2,
    requiredOkCount: 2,
    summary: 'completed',
    reports: [
      {
        scoutName: 'scout-code-path',
        status: 'ok',
        outcome: 'ok',
        findings: [
          {
            file: 'apps/web/src/components/detail/lib/costs.ts',
            fact: 'costs.ts exports useIssueCostsBreakdown.',
            confidence: 'high',
          },
        ],
        decisionSummaries: [],
        runId: 'run:scout-code-path',
      },
      {
        scoutName: 'scout-test-inventory',
        status: 'ok',
        outcome: 'ok',
        findings: [
          {
            file: 'apps/web/src/components/detail/lib/costs.test.ts',
            fact: 'Existing test surface covers costs.',
            confidence: 'high',
          },
        ],
        decisionSummaries: [{ kind: 'UNCERTAINTY', summary: 'Product card ordering is unclear.' }],
        runId: 'run:scout-test',
      },
    ],
  });
  mockPersistScoutReportForRun.mockImplementation(
    (_projectId, _workItemId, _runId, _skill, report) => report,
  );
});

describe('feature-grounding workflow', () => {
  it('dispatches a scout wave, persists scout reports, emits grounding complete, and routes to grilling', async () => {
    const { runFeatureGroundingWorkflow } = await import('./workflow.js');
    await runFeatureGroundingWorkflow(makeWorkItem(), makeSource(), 'goose-hub-self', '/repo', {
      createWorktreeImpl: () => '/tmp/grounding-worktree',
      cleanupWorktreeImpl: vi.fn(),
    });

    expect(mockDispatchWave).toHaveBeenCalledWith(
      expect.objectContaining({
        parentRunId: expect.any(String),
        worktreePath: '/tmp/grounding-worktree',
        minSuccessfulScouts: 2,
      }),
    );
    expect(mockPersistScoutReportForRun).toHaveBeenCalledTimes(2);
    const groundingEvent = mockAppendEvent.mock.calls.find(
      ([event]) => event.kind === 'feature.grounding-complete',
    )?.[0];
    expect(groundingEvent.payload).toMatchObject({
      groundingRunId: expect.any(String),
      existingSurfaces: ['apps/web/src/components/detail/lib/costs.ts'],
      testSurfaces: ['apps/web/src/components/detail/lib/costs.test.ts'],
      confirmedExports: [
        expect.objectContaining({
          path: 'apps/web/src/components/detail/lib/costs.ts',
          symbol: 'useIssueCostsBreakdown',
        }),
      ],
      openQuestions: ['Product card ordering is unclear.'],
    });
    expect(mockTransitionAndEmitState).toHaveBeenCalledWith(
      expect.objectContaining({
        from: 'factory:grounding',
        to: 'factory:grilling',
        by: 'feature-grounding',
      }),
    );
  });

  it('uses framed context and routes skip-grill features to PRD drafting', async () => {
    mockReplay.mockReturnValue([
      {
        kind: 'feature.framed',
        payload: {
          framedBody: 'Original\n\nFramed details',
          refinedIntent: 'Add grounded feature',
          stillNeedsGrilling: false,
        },
      },
    ]);
    const { runFeatureGroundingWorkflow } = await import('./workflow.js');
    const result = await runFeatureGroundingWorkflow(
      makeWorkItem(),
      makeSource(),
      'goose-hub-self',
      '/repo',
      {
        createWorktreeImpl: () => '/tmp/grounding-worktree',
        cleanupWorktreeImpl: vi.fn(),
      },
    );

    expect(result.nextState).toBe('factory:prd-drafting');
    expect(mockDispatchWave).toHaveBeenCalledWith(
      expect.objectContaining({
        workItem: expect.objectContaining({ body: 'Original\n\nFramed details' }),
      }),
    );
    const groundingEvent = mockAppendEvent.mock.calls.find(
      ([event]) => event.kind === 'feature.grounding-complete',
    )?.[0];
    expect(groundingEvent.payload).toMatchObject({
      refinedIntent: 'Add grounded feature',
    });
    expect(mockTransitionAndEmitState).toHaveBeenCalledWith(
      expect.objectContaining({
        from: 'factory:grounding',
        to: 'factory:prd-drafting',
      }),
    );
  });
});
