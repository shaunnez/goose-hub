import type { StateSource, WorkItem } from '@goose-hub/core/state-source/interface.js';
import type { WorkflowRouteDecision } from '@goose-hub/core/workflow-routing/types.js';
import type { FeatureEnhanceOutput } from '@goose-hub/skills/feature-enhance/schema.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockDispatchWave = vi.fn();
const mockInvokeSkill = vi.fn();
const mockPersistScoutReportForRun = vi.fn();
const mockAppendEvent = vi.fn();
const mockReplay = vi.fn();
const mockTransitionAndEmitState = vi.fn();

vi.mock('@goose-hub/core/agent-runtime/swarm.js', () => ({
  dispatchWave: (...args: unknown[]) => mockDispatchWave(...args),
}));

vi.mock('@goose-hub/core/agent-runtime/invoke-skill.js', () => ({
  invokeSkill: (...args: unknown[]) => mockInvokeSkill(...args),
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

function makeWorkItem(type: WorkItem['type'] = 'feature'): WorkItem {
  return {
    id: 'github:shaunnez/goose-hub#1176',
    externalId: '1176',
    repoRef: 'shaunnez/goose-hub',
    title: 'Add workflow snapshot costs',
    body: 'Show cost cards on the detail page.',
    type,
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

function route(
  tier: WorkflowRouteDecision['tier'],
  overrides: Partial<WorkflowRouteDecision> = {},
): WorkflowRouteDecision {
  const budgetByTier: Record<WorkflowRouteDecision['tier'], WorkflowRouteDecision['budgetCaps']> = {
    T0: { maxUsd: 0.3, maxScouts: 0, allowWave2: false, reviewerSlots: 1 },
    T1: { maxUsd: 0.8, maxScouts: 1, allowWave2: false, reviewerSlots: 1 },
    T2: { maxUsd: 2, maxScouts: 3, allowWave2: false, reviewerSlots: 1 },
    T3: { maxUsd: 6, maxScouts: 6, allowWave2: true, reviewerSlots: 2 },
    T4: { maxUsd: 0, maxScouts: 0, allowWave2: false, reviewerSlots: 1 },
  };
  const stagesByTier: Record<
    WorkflowRouteDecision['tier'],
    WorkflowRouteDecision['selectedStages']
  > = {
    T0: ['triage', 'implement', 'qa', 'review', 'retro'],
    T1: ['triage', 'investigate', 'implement', 'qa', 'review', 'retro'],
    T2: ['triage', 'investigate', 'spec-author', 'implement', 'qa', 'review', 'retro'],
    T3: ['triage', 'investigate', 'spec-author', 'parallel-implement', 'qa', 'review', 'retro'],
    T4: ['triage'],
  };
  return {
    tier,
    selectedStages: stagesByTier[tier],
    budgetCaps: budgetByTier[tier],
    evidence: { reasons: [], signals: {} },
    escalationTriggers: [],
    requiresHumanApproval: false,
    source: 'promotion',
    rootCauseSignature: `route|test|${tier}`,
    ...overrides,
  };
}

function enhancement(overrides: Partial<FeatureEnhanceOutput> = {}): FeatureEnhanceOutput {
  return {
    candidateFiles: [
      {
        path: 'slices/feature-grounding/workflow.ts',
        confidence: 'high',
        source: 'tool-verified',
        reason: 'Existing feature grounding workflow.',
      },
    ],
    existingSurfaces: ['slices/feature-grounding/workflow.ts'],
    similarPatterns: ['Feature grounding emits code-grounding events.'],
    testSurfaces: ['slices/feature-grounding/slice.test.ts'],
    acceptanceHints: ['Grounding completes before implementation dispatch.'],
    openQuestions: [],
    confidence: 'high',
    escalationSignals: [],
    ...overrides,
  };
}

function replayWith(input: { framed?: unknown; selectedRoute?: WorkflowRouteDecision } = {}) {
  mockReplay.mockImplementation((query: { kind?: string }) => {
    if (query.kind === 'feature.framed') return input.framed != null ? [input.framed] : [];
    if (query.kind === 'workflow.route-selected') {
      return input.selectedRoute != null
        ? [{ kind: query.kind, payload: input.selectedRoute }]
        : [];
    }
    if (query.kind === 'workflow.route-confirmed') return [];
    return [];
  });
}

async function runWith(routeDecision: WorkflowRouteDecision, output: FeatureEnhanceOutput) {
  replayWith({ selectedRoute: routeDecision });
  mockInvokeSkill.mockResolvedValueOnce({
    output,
    decisionSummaries: [],
    events: [],
    personaId: 'triager-test',
    role: 'triager',
  });
  const { runFeatureGroundingWorkflow } = await import('./workflow.js');
  return runFeatureGroundingWorkflow(
    makeWorkItem(),
    makeSource(),
    'goose-hub-self',
    process.cwd(),
    {
      createWorktreeImpl: () => process.cwd(),
      cleanupWorktreeImpl: vi.fn(),
    },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  replayWith();
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
            file: 'slices/feature-grounding/workflow.ts',
            fact: 'workflow.ts exports runFeatureGroundingWorkflow.',
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
            file: 'slices/feature-grounding/slice.test.ts',
            fact: 'Existing test surface covers grounding workflow.',
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
  it('T0 runs feature-enhance, persists grounding, and advances without scouts', async () => {
    const result = await runWith(route('T0'), enhancement());

    expect(result.nextState).toBe('factory:dev-ready');
    expect(mockInvokeSkill).toHaveBeenCalledWith(
      expect.objectContaining({ skillName: 'feature-enhance' }),
    );
    expect(mockDispatchWave).not.toHaveBeenCalled();
    const enhancedEvent = mockAppendEvent.mock.calls.find(
      ([event]) => event.kind === 'feature.grounding-enhanced',
    )?.[0];
    expect(enhancedEvent.payload).toMatchObject({
      routeTier: 'T0',
      confidence: 'high',
      investigationSeed: {
        candidateFiles: [{ path: 'slices/feature-grounding/workflow.ts', root: 'worktree' }],
      },
    });
    const completeEvent = mockAppendEvent.mock.calls.find(
      ([event]) => event.kind === 'feature.grounding-complete',
    )?.[0];
    expect(completeEvent.payload).toMatchObject({
      candidateFiles: [{ path: 'slices/feature-grounding/workflow.ts', confidence: 'high' }],
      existingSurfaces: ['slices/feature-grounding/workflow.ts'],
      scoutsLaunched: [],
    });
    expect(mockTransitionAndEmitState).toHaveBeenCalledWith(
      expect.objectContaining({
        from: 'factory:grounding',
        to: 'factory:dev-ready',
        by: 'feature-grounding',
      }),
    );
  });

  it('honors maxScouts:0 even when selected stages include investigation', async () => {
    await runWith(
      route('T1', {
        budgetCaps: { maxUsd: 0.8, maxScouts: 0, allowWave2: false, reviewerSlots: 1 },
      }),
      enhancement({ confidence: 'low', escalationSignals: ['broad surface'] }),
    );

    expect(mockDispatchWave).not.toHaveBeenCalled();
    expect(mockTransitionAndEmitState).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'factory:grilling' }),
    );
  });

  it('T1 low-confidence feature runs a seeded focused scout subset', async () => {
    await runWith(route('T1'), enhancement({ confidence: 'low' }));

    expect(mockDispatchWave).toHaveBeenCalledWith(
      expect.objectContaining({
        scoutSpecs: [
          expect.objectContaining({
            scoutName: 'scout-code-path',
            extraContext: expect.objectContaining({
              investigationSeed: expect.objectContaining({
                candidateFiles: [
                  { path: 'slices/feature-grounding/workflow.ts', root: 'worktree' },
                ],
              }),
            }),
          }),
        ],
        minSuccessfulScouts: 1,
      }),
    );
  });

  it('T2 feature runs seeded scout fanout capped by route', async () => {
    await runWith(route('T2'), enhancement({ confidence: 'medium' }));

    const call = mockDispatchWave.mock.calls[0]?.[0];
    expect(call.scoutSpecs.map((spec: { scoutName: string }) => spec.scoutName)).toEqual([
      'scout-code-path',
      'scout-dependency',
      'scout-pattern',
    ]);
    expect(call.scoutSpecs[0].extraContext.investigationSeed.candidateFiles).toEqual([
      { path: 'slices/feature-grounding/workflow.ts', root: 'worktree' },
    ]);
  });

  it('empty feature-enhance output asks for product clarification instead of implementation guessing', async () => {
    const result = await runWith(
      route('T0'),
      enhancement({
        candidateFiles: [],
        existingSurfaces: [],
        similarPatterns: [],
        testSurfaces: [],
        acceptanceHints: [],
        openQuestions: ['No matching repo surface found.'],
        confidence: 'low',
        escalationSignals: ['needs product clarification'],
      }),
    );

    expect(result.nextState).toBe('factory:grilling');
    expect(mockDispatchWave).not.toHaveBeenCalled();
    expect(mockTransitionAndEmitState).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'factory:grilling' }),
    );
  });

  it('uses framed context and routes skip-grill low-confidence features to PRD drafting', async () => {
    replayWith({
      selectedRoute: route('T0'),
      framed: {
        kind: 'feature.framed',
        payload: {
          framedBody: 'Original\n\nFramed details',
          refinedIntent: 'Add grounded feature',
          stillNeedsGrilling: false,
        },
      },
    });
    mockInvokeSkill.mockResolvedValueOnce({
      output: enhancement({
        candidateFiles: [],
        existingSurfaces: [],
        similarPatterns: [],
        testSurfaces: [],
        confidence: 'low',
        escalationSignals: ['needs PRD clarification'],
      }),
      decisionSummaries: [],
      events: [],
      personaId: 'triager-test',
      role: 'triager',
    });
    const { runFeatureGroundingWorkflow } = await import('./workflow.js');
    const result = await runFeatureGroundingWorkflow(
      makeWorkItem(),
      makeSource(),
      'goose-hub-self',
      process.cwd(),
      {
        createWorktreeImpl: () => process.cwd(),
        cleanupWorktreeImpl: vi.fn(),
      },
    );

    expect(result.nextState).toBe('factory:prd-drafting');
    expect(mockInvokeSkill).toHaveBeenCalledWith(
      expect.objectContaining({
        context: expect.objectContaining({
          workItem: expect.objectContaining({ body: 'Original\n\nFramed details' }),
          framedFeature: expect.objectContaining({ refinedIntent: 'Add grounded feature' }),
        }),
      }),
    );
    expect(mockTransitionAndEmitState).toHaveBeenCalledWith(
      expect.objectContaining({
        from: 'factory:grounding',
        to: 'factory:prd-drafting',
      }),
    );
  });
});
