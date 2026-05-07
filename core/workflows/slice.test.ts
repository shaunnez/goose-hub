import { beforeEach, describe, expect, it, vi } from 'vitest';

// ─── module mocks ─────────────────────────────────────────────────────────────

const mockRun = vi.fn();
const mockAccumulatePersonaStats = vi.fn();

vi.mock('../agent-runtime/claude-cli.js', () => ({
  ClaudeCliRuntime: vi.fn().mockImplementation(() => ({ run: mockRun })),
}));
vi.mock('../persona/accumulate.js', () => ({
  accumulatePersonaStats: (...args: unknown[]) => mockAccumulatePersonaStats(...args),
}));
vi.mock('../agent-runtime/schema-bridge.js', () => ({
  toJsonSchema: vi.fn().mockReturnValue({}),
}));
vi.mock('../agent-runtime/select-persona.js', () => ({
  selectPersona: vi
    .fn()
    .mockReturnValue({ personaId: 'test-project/retrospector/0', codename: 'Grey Honker' }),
}));
vi.mock('../event-stream/store.js', () => ({
  eventStore: {
    appendEvent: vi
      .fn()
      .mockReturnValue({ id: 1, kind: 'retrospective.completed', payload: {}, createdAt: '' }),
    replay: vi.fn().mockReturnValue([]),
  },
}));
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    readFileSync: vi.fn().mockReturnValue('# mock skill prompt'),
    existsSync: vi.fn().mockReturnValue(true),
  };
});

// ─── helpers ─────────────────────────────────────────────────────────────────

import type { StateSource, WorkItem } from '../state-source/interface.js';

function makeWorkItem(overrides: Partial<WorkItem> = {}): WorkItem {
  return {
    id: 'github:owner/repo#42',
    externalId: '42',
    repoRef: 'owner/repo',
    title: 'Shipped feature',
    body: 'body',
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

function makeSource(overrides: Partial<StateSource> = {}): StateSource {
  return {
    projectId: 'test-project',
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
    ...overrides,
  };
}

function makeLightResult() {
  return {
    output: {
      outcome: 'success',
      workItemNumber: 42,
      summary: {
        wentWell: 'All good.',
        didNotGoWell: 'No issues.',
        architecturalTakeaway: 'Keep it up.',
      },
      improvementCandidates: [],
      decisionSummaries: [{ kind: 'VERDICT', summary: 'Clean run' }],
    },
    decisionSummaries: [],
    events: [],
  };
}

function makeDeepResult() {
  return {
    output: {
      outcome: 'success',
      workItemNumber: 42,
      summary: {
        wentWell: 'Good.',
        didNotGoWell: 'QA failed once.',
        architecturalTakeaway: 'Adjust prompt.',
      },
      triggerReasons: ['standard-deep'],
      personaQualityScores: [],
      learningEntries: [],
      decisionPatterns: [],
      improvementCandidates: [],
      decisionSummaries: [{ kind: 'VERDICT', summary: 'Deep retro complete' }],
    },
    decisionSummaries: [],
    events: [],
  };
}

beforeEach(() => {
  mockRun.mockReset();
  mockAccumulatePersonaStats.mockClear();
  vi.clearAllMocks();
});

// ─── tier selection ───────────────────────────────────────────────────────────

describe('tier selection', () => {
  it('always-light policy runs retrospective-light regardless of triggers', async () => {
    const { runRetrospectiveWorkflow } = await import('./retrospective.js');
    mockRun.mockResolvedValueOnce(makeLightResult());

    await runRetrospectiveWorkflow({
      workItem: makeWorkItem(),
      stateSource: makeSource(),
      projectId: 'test-project',
      policy: 'always-light',
      triggers: { qaFailed: true, firstRunInMilestone: true },
    });

    const spec = mockRun.mock.calls[0][0] as { skill: string };
    expect(spec.skill).toBe('retrospective-light');
  });

  it('always-deep policy runs retrospective-deep regardless of triggers', async () => {
    const { runRetrospectiveWorkflow } = await import('./retrospective.js');
    mockRun.mockResolvedValueOnce(makeDeepResult());

    await runRetrospectiveWorkflow({
      workItem: makeWorkItem(),
      stateSource: makeSource(),
      projectId: 'test-project',
      policy: 'always-deep',
    });

    const spec = mockRun.mock.calls[0][0] as { skill: string };
    expect(spec.skill).toBe('retrospective-deep');
  });

  it('auto + no triggers → retrospective-light', async () => {
    const { runRetrospectiveWorkflow } = await import('./retrospective.js');
    mockRun.mockResolvedValueOnce(makeLightResult());

    await runRetrospectiveWorkflow({
      workItem: makeWorkItem(),
      stateSource: makeSource(),
      projectId: 'test-project',
      policy: 'auto',
    });

    const spec = mockRun.mock.calls[0][0] as { skill: string };
    expect(spec.skill).toBe('retrospective-light');
  });

  it('auto + qaFailed → retrospective-deep', async () => {
    const { runRetrospectiveWorkflow } = await import('./retrospective.js');
    mockRun.mockResolvedValueOnce(makeDeepResult());

    await runRetrospectiveWorkflow({
      workItem: makeWorkItem(),
      stateSource: makeSource(),
      projectId: 'test-project',
      policy: 'auto',
      triggers: { qaFailed: true },
    });

    const spec = mockRun.mock.calls[0][0] as { skill: string };
    expect(spec.skill).toBe('retrospective-deep');
  });

  it('auto + firstRunInMilestone → retrospective-deep', async () => {
    const { runRetrospectiveWorkflow } = await import('./retrospective.js');
    mockRun.mockResolvedValueOnce(makeDeepResult());

    await runRetrospectiveWorkflow({
      workItem: makeWorkItem(),
      stateSource: makeSource(),
      projectId: 'test-project',
      policy: 'auto',
      triggers: { firstRunInMilestone: true },
    });

    const spec = mockRun.mock.calls[0][0] as { skill: string };
    expect(spec.skill).toBe('retrospective-deep');
  });

  it('auto + qualityScoreDeclining → retrospective-deep', async () => {
    const { runRetrospectiveWorkflow } = await import('./retrospective.js');
    mockRun.mockResolvedValueOnce(makeDeepResult());

    await runRetrospectiveWorkflow({
      workItem: makeWorkItem(),
      stateSource: makeSource(),
      projectId: 'test-project',
      policy: 'auto',
      triggers: { qualityScoreDeclining: true },
    });

    const spec = mockRun.mock.calls[0][0] as { skill: string };
    expect(spec.skill).toBe('retrospective-deep');
  });

  it('auto + humanRequested → retrospective-deep', async () => {
    const { runRetrospectiveWorkflow } = await import('./retrospective.js');
    mockRun.mockResolvedValueOnce(makeDeepResult());

    await runRetrospectiveWorkflow({
      workItem: makeWorkItem(),
      stateSource: makeSource(),
      projectId: 'test-project',
      policy: 'auto',
      triggers: { humanRequested: true },
    });

    const spec = mockRun.mock.calls[0][0] as { skill: string };
    expect(spec.skill).toBe('retrospective-deep');
  });

  it('auto + retriesGe2 → retrospective-deep', async () => {
    const { runRetrospectiveWorkflow } = await import('./retrospective.js');
    mockRun.mockResolvedValueOnce(makeDeepResult());

    await runRetrospectiveWorkflow({
      workItem: makeWorkItem(),
      stateSource: makeSource(),
      projectId: 'test-project',
      policy: 'auto',
      triggers: { retriesGe2: true },
    });

    const spec = mockRun.mock.calls[0][0] as { skill: string };
    expect(spec.skill).toBe('retrospective-deep');
  });

  it('auto + budgetExceeded → retrospective-deep', async () => {
    const { runRetrospectiveWorkflow } = await import('./retrospective.js');
    mockRun.mockResolvedValueOnce(makeDeepResult());

    await runRetrospectiveWorkflow({
      workItem: makeWorkItem(),
      stateSource: makeSource(),
      projectId: 'test-project',
      policy: 'auto',
      triggers: { budgetExceeded: true },
    });

    const spec = mockRun.mock.calls[0][0] as { skill: string };
    expect(spec.skill).toBe('retrospective-deep');
  });

  it('auto + priorityHigh → retrospective-deep', async () => {
    const { runRetrospectiveWorkflow } = await import('./retrospective.js');
    mockRun.mockResolvedValueOnce(makeDeepResult());

    await runRetrospectiveWorkflow({
      workItem: makeWorkItem(),
      stateSource: makeSource(),
      projectId: 'test-project',
      policy: 'auto',
      triggers: { priorityHigh: true },
    });

    const spec = mockRun.mock.calls[0][0] as { skill: string };
    expect(spec.skill).toBe('retrospective-deep');
  });
});

// ─── context assembly ─────────────────────────────────────────────────────────

describe('context assembly', () => {
  it('passes prior decision summaries from event store to run context', async () => {
    const { runRetrospectiveWorkflow } = await import('./retrospective.js');
    const { eventStore } = await import('../event-stream/store.js');

    vi.mocked(eventStore.replay).mockReturnValueOnce([
      {
        id: 1,
        projectId: 'test-project',
        workItemId: 'github:owner/repo#42',
        kind: 'agent.decision-summary',
        payload: { skill: 'implement', kind: 'PLAN', summary: 'Added widget', evidence: 'tests' },
        runId: 'run-1',
        personaId: null,
        createdAt: '2026-01-01T00:00:00Z',
      },
      {
        id: 2,
        projectId: 'test-project',
        workItemId: 'github:owner/repo#42',
        kind: 'agent.run-started',
        payload: { skill: 'implement' },
        runId: 'run-1',
        personaId: null,
        createdAt: '2026-01-01T00:00:00Z',
      },
    ]);
    mockRun.mockResolvedValueOnce(makeLightResult());

    await runRetrospectiveWorkflow({
      workItem: makeWorkItem(),
      stateSource: makeSource(),
      projectId: 'test-project',
      policy: 'always-light',
    });

    const runSpec = mockRun.mock.calls[0][0] as {
      context: { runSummary: { decisionSummaries: unknown[] } };
    };
    expect(runSpec.context.runSummary.decisionSummaries).toHaveLength(1);
    expect(runSpec.context.runSummary.decisionSummaries[0]).toMatchObject({
      kind: 'PLAN',
      summary: 'Added widget',
    });
  });

  it('emits agent.decision-summary events from the retro output', async () => {
    const { runRetrospectiveWorkflow } = await import('./retrospective.js');
    const { eventStore } = await import('../event-stream/store.js');

    const resultWithSummaries = {
      output: {
        outcome: 'success',
        workItemNumber: 42,
        summary: {
          wentWell: 'All good.',
          didNotGoWell: 'No issues.',
          architecturalTakeaway: 'Keep it up.',
        },
        improvementCandidates: [],
        decisionSummaries: [{ kind: 'VERDICT', summary: 'Clean run — no friction detected' }],
      },
      decisionSummaries: [], // runtime always returns [] — bug being fixed
      events: [],
    };
    mockRun.mockResolvedValueOnce(resultWithSummaries);

    await runRetrospectiveWorkflow({
      workItem: makeWorkItem(),
      stateSource: makeSource(),
      projectId: 'test-project',
      policy: 'always-light',
    });

    const summaryEvents = vi
      .mocked(eventStore.appendEvent)
      .mock.calls.filter(([e]) => e.kind === 'agent.decision-summary');

    expect(summaryEvents).toHaveLength(1);
    const payload = summaryEvents[0][0].payload as { kind: string; summary: string };
    expect(payload.kind).toBe('VERDICT');
    expect(payload.summary).toBe('Clean run — no friction detected');
  });
});

// ─── state transitions ────────────────────────────────────────────────────────

describe('state transitions', () => {
  it('transitions to factory:done after successful retro', async () => {
    const { runRetrospectiveWorkflow } = await import('./retrospective.js');
    const source = makeSource();
    mockRun.mockResolvedValueOnce(makeLightResult());

    await runRetrospectiveWorkflow({
      workItem: makeWorkItem(),
      stateSource: source,
      projectId: 'test-project',
      policy: 'always-light',
    });

    expect(source.transitionState).toHaveBeenCalledWith(
      '42',
      'factory:retrospecting',
      'factory:done',
    );
    expect(mockAccumulatePersonaStats).toHaveBeenCalledWith({
      personaName: 'test-project/retrospector/0',
      role: 'retrospector',
      outcome: 'success',
    });
  });

  it('emits retrospective.completed event with tier info', async () => {
    const { runRetrospectiveWorkflow } = await import('./retrospective.js');
    const { eventStore } = await import('../event-stream/store.js');
    mockRun.mockResolvedValueOnce(makeLightResult());

    await runRetrospectiveWorkflow({
      workItem: makeWorkItem(),
      stateSource: makeSource(),
      projectId: 'test-project',
      policy: 'always-light',
    });

    const retroEvent = vi
      .mocked(eventStore.appendEvent)
      .mock.calls.find(([e]) => e.kind === 'retrospective.completed');
    expect(retroEvent).toBeDefined();
    const payload = retroEvent?.[0].payload as { tier: string };
    expect(payload.tier).toBe('light');
  });

  it('transitions to factory:needs-human and accumulates failure stat on error', async () => {
    const { runRetrospectiveWorkflow } = await import('./retrospective.js');
    const source = makeSource();
    mockRun.mockRejectedValueOnce(new Error('agent exploded'));

    await runRetrospectiveWorkflow({
      workItem: makeWorkItem(),
      stateSource: source,
      projectId: 'test-project',
      policy: 'always-light',
    });

    expect(source.transitionState).toHaveBeenCalledWith(
      '42',
      'factory:retrospecting',
      'factory:needs-human',
    );
    expect(mockAccumulatePersonaStats).toHaveBeenCalledWith({
      personaName: 'test-project/retrospector/0',
      role: 'retrospector',
      outcome: 'failure',
    });
  });

  it('emits agent.run-failed and transitions to factory:needs-human when output fails schema parse', async () => {
    const { runRetrospectiveWorkflow } = await import('./retrospective.js');
    const { eventStore } = await import('../event-stream/store.js');
    const source = makeSource();

    // missing required fields (outcome, workItemNumber, summary as object)
    mockRun.mockResolvedValueOnce({
      output: { summary: 'free text', decisionSummaries: [] },
      decisionSummaries: [],
      events: [],
    });

    await runRetrospectiveWorkflow({
      workItem: makeWorkItem(),
      stateSource: source,
      projectId: 'test-project',
      policy: 'always-light',
    });

    const failedEvent = vi
      .mocked(eventStore.appendEvent)
      .mock.calls.find(([e]) => e.kind === 'agent.run-failed');
    expect(failedEvent).toBeDefined();
    const payload = failedEvent?.[0].payload as { skill: string; error: string };
    expect(payload.skill).toBe('retrospective-light');
    expect(payload.error.length).toBeGreaterThan(0);

    const completedEvent = vi
      .mocked(eventStore.appendEvent)
      .mock.calls.find(([e]) => e.kind === 'retrospective.completed');
    expect(completedEvent).toBeUndefined();

    expect(source.transitionState).toHaveBeenCalledWith(
      '42',
      'factory:retrospecting',
      'factory:needs-human',
    );
    expect(mockAccumulatePersonaStats).toHaveBeenCalledWith({
      personaName: 'test-project/retrospector/0',
      role: 'retrospector',
      outcome: 'failure',
    });
  });
});

// ─── skill-coaching workflow ──────────────────────────────────────────────────

function makeCoachResult() {
  return {
    output: {
      skillName: 'implement',
      diagnosis: 'Skill lacks explicit slice.test.ts reminder',
      proposedPatch:
        '--- a/skills/implement/prompt.md\n+++ b/skills/implement/prompt.md\n@@ -10,0 +11 @@\n+Write slice.test.ts first.',
      rationale:
        'Pattern PLAN::developer recurred consistently; the skill prompt does not mandate slice.test.ts.',
      evidencePatternIds: ['PLAN::developer'],
      confidence: 'high',
      decisionSummaries: [{ kind: 'VERDICT', summary: 'Coached implement: add TDD reminder' }],
    },
    decisionSummaries: [],
    events: [],
  };
}

describe('skill-coaching workflow — forbidden targets', () => {
  it.each([
    'qa',
    'review',
    'retrospective-light',
    'retrospective-deep',
    'retrospective-cross-run',
    'skill-coach',
  ])('throws SkillCoachForbiddenTargetError for "%s"', async (target) => {
    const { runSkillCoachingWorkflow, SkillCoachForbiddenTargetError } = await import(
      './skill-coaching.js'
    );
    await expect(
      runSkillCoachingWorkflow({
        projectId: 'test-project',
        targetSkillName: target,
        evidence: { patternIds: [] },
        deps: { runtime: { run: mockRun } },
      }),
    ).rejects.toBeInstanceOf(SkillCoachForbiddenTargetError);
  });
});

describe('skill-coaching workflow — missing skill source', () => {
  it('throws SkillCoachMissingSourceError when prompt.md is absent', async () => {
    const { existsSync } = await import('node:fs');
    vi.mocked(existsSync).mockReturnValueOnce(false);

    const { runSkillCoachingWorkflow, SkillCoachMissingSourceError } = await import(
      './skill-coaching.js'
    );
    await expect(
      runSkillCoachingWorkflow({
        projectId: 'test-project',
        targetSkillName: 'implement',
        evidence: { patternIds: [] },
        deps: { runtime: { run: mockRun } },
      }),
    ).rejects.toBeInstanceOf(SkillCoachMissingSourceError);

    expect(mockRun).not.toHaveBeenCalled();
  });
});

describe('skill-coaching workflow — schema validation failure', () => {
  it('returns ok: false when coach output fails schema parse', async () => {
    mockRun.mockResolvedValueOnce({
      output: { invalid: 'output' },
      decisionSummaries: [],
      events: [],
    });

    const { runSkillCoachingWorkflow } = await import('./skill-coaching.js');
    const result = await runSkillCoachingWorkflow({
      projectId: 'test-project',
      targetSkillName: 'implement',
      evidence: { patternIds: [] },
      deps: { runtime: { run: mockRun } },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.length).toBeGreaterThan(0);
    }
  });
});

describe('skill-coaching workflow — happy path', () => {
  it('dispatches skill-coach and returns a valid candidate result', async () => {
    mockRun.mockResolvedValueOnce(makeCoachResult());

    const { runSkillCoachingWorkflow } = await import('./skill-coaching.js');
    const result = await runSkillCoachingWorkflow({
      projectId: 'test-project',
      targetSkillName: 'implement',
      evidence: { patternIds: ['PLAN::developer'] },
      deps: { runtime: { run: mockRun } },
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.skillName).toBe('implement');
      expect(result.confidence).toBe('high');
      expect(result.proposedPatch.length).toBeGreaterThan(0);
      expect(typeof result.candidateId).toBe('number');
    }
  });

  it('dispatches with skill: skill-coach in the run spec', async () => {
    mockRun.mockResolvedValueOnce(makeCoachResult());

    const { runSkillCoachingWorkflow } = await import('./skill-coaching.js');
    await runSkillCoachingWorkflow({
      projectId: 'test-project',
      targetSkillName: 'implement',
      evidence: { patternIds: [] },
      deps: { runtime: { run: mockRun } },
    });

    const spec = mockRun.mock.calls[0][0] as { skill: string; role: string };
    expect(spec.skill).toBe('skill-coach');
    expect(spec.role).toBe('retrospector');
  });

  it('emits coach.completed event on success', async () => {
    mockRun.mockResolvedValueOnce(makeCoachResult());

    const { runSkillCoachingWorkflow } = await import('./skill-coaching.js');
    const { eventStore } = await import('../event-stream/store.js');

    await runSkillCoachingWorkflow({
      projectId: 'test-project',
      targetSkillName: 'implement',
      evidence: { patternIds: [] },
      deps: { runtime: { run: mockRun } },
    });

    const coachEvent = vi
      .mocked(eventStore.appendEvent)
      .mock.calls.find(([e]) => e.kind === 'coach.completed');
    expect(coachEvent).toBeDefined();
    const payload = coachEvent?.[0].payload as { targetSkillName: string };
    expect(payload.targetSkillName).toBe('implement');
  });
});
