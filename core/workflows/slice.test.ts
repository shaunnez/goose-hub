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
  selectPersona: vi.fn().mockImplementation((projectId: string, role: string) => {
    const codenames: Record<string, string> = {
      retrospector: 'Grey Honker',
      developer: 'Skywalker',
    };
    return { personaId: `${projectId}/${role}/0`, codename: codenames[role] || 'Unknown' };
  }),
}));
vi.mock('../event-stream/store.js', () => ({
  eventStore: {
    appendEvent: vi
      .fn()
      .mockReturnValue({ id: 1, kind: 'retrospective.completed', payload: {}, createdAt: '' }),
    replay: vi.fn().mockReturnValue([]),
  },
}));
const mockReadFileSync = vi.fn().mockReturnValue('# mock skill prompt');

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return { ...actual, readFileSync: mockReadFileSync };
});

vi.mock('../agent-runtime/read-prompt.js', () => ({
  readPromptWithContext: vi.fn().mockReturnValue('# mock skill prompt with context'),
}));

vi.mock('../projects/loader.js', () => ({
  getProjectBySlug: vi.fn().mockResolvedValue({ budgets: {} }),
}));

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

describe('skill-coaching workflow', () => {
  it('rejects forbidden target before dispatch', async () => {
    const { runSkillCoachingWorkflow } = await import('./skill-coaching.js');
    const { eventStore } = await import('../event-stream/store.js');

    await runSkillCoachingWorkflow({
      projectId: 'test-project',
      targetSkillName: 'qa',
      patternIds: ['p1'],
    });

    const failedEvent = vi
      .mocked(eventStore.appendEvent)
      .mock.calls.find(([e]) => e.kind === 'agent.run-failed');
    expect(failedEvent).toBeDefined();

    // Verify that agent.run was NOT called for forbidden target
    expect(mockRun).not.toHaveBeenCalled();

    // Verify persona stat recorded as failure
    expect(mockAccumulatePersonaStats).toHaveBeenCalledWith(
      expect.objectContaining({
        role: 'developer',
        outcome: 'failure',
      }),
    );
  });

  it('rejects review skill as forbidden', async () => {
    const { runSkillCoachingWorkflow } = await import('./skill-coaching.js');
    const { eventStore } = await import('../event-stream/store.js');

    await runSkillCoachingWorkflow({
      projectId: 'test-project',
      targetSkillName: 'review',
      patternIds: ['p1'],
    });

    const failedEvent = vi
      .mocked(eventStore.appendEvent)
      .mock.calls.find(([e]) => e.kind === 'agent.run-failed');
    expect(failedEvent).toBeDefined();
    expect(mockRun).not.toHaveBeenCalled();
  });

  it('rejects retrospective-light as forbidden', async () => {
    const { runSkillCoachingWorkflow } = await import('./skill-coaching.js');
    const { eventStore } = await import('../event-stream/store.js');

    await runSkillCoachingWorkflow({
      projectId: 'test-project',
      targetSkillName: 'retrospective-light',
      patternIds: ['p1'],
    });

    const failedEvent = vi
      .mocked(eventStore.appendEvent)
      .mock.calls.find(([e]) => e.kind === 'agent.run-failed');
    expect(failedEvent).toBeDefined();
    expect(mockRun).not.toHaveBeenCalled();
  });

  it('rejects skill-coach as forbidden (cannot coach itself)', async () => {
    const { runSkillCoachingWorkflow } = await import('./skill-coaching.js');
    const { eventStore } = await import('../event-stream/store.js');

    await runSkillCoachingWorkflow({
      projectId: 'test-project',
      targetSkillName: 'skill-coach',
      patternIds: ['p1'],
    });

    const failedEvent = vi
      .mocked(eventStore.appendEvent)
      .mock.calls.find(([e]) => e.kind === 'agent.run-failed');
    expect(failedEvent).toBeDefined();
    expect(mockRun).not.toHaveBeenCalled();
  });

  it('emits agent.run-failed and failure stat on schema validation error', async () => {
    const { runSkillCoachingWorkflow } = await import('./skill-coaching.js');
    const { eventStore } = await import('../event-stream/store.js');
    mockRun.mockResolvedValueOnce({
      output: {
        skillName: 'investigate',
        // missing diagnosis, proposedPatch, etc.
        confidence: 'high',
        decisionSummaries: [],
      },
      decisionSummaries: [],
      events: [],
    });

    await runSkillCoachingWorkflow({
      projectId: 'test-project',
      targetSkillName: 'investigate',
      patternIds: ['p1'],
    });

    const failedEvent = vi
      .mocked(eventStore.appendEvent)
      .mock.calls.find(([e]) => e.kind === 'agent.run-failed');
    expect(failedEvent).toBeDefined();

    expect(mockAccumulatePersonaStats).toHaveBeenCalledWith({
      personaName: 'test-project/developer/0',
      role: 'developer',
      outcome: 'failure',
    });
  });

  it('emits agent.run-failed on runtime exception', async () => {
    const { runSkillCoachingWorkflow } = await import('./skill-coaching.js');
    const { eventStore } = await import('../event-stream/store.js');
    mockRun.mockRejectedValueOnce(new Error('network error'));

    await runSkillCoachingWorkflow({
      projectId: 'test-project',
      targetSkillName: 'investigate',
      patternIds: ['p1'],
    });

    const failedEvent = vi
      .mocked(eventStore.appendEvent)
      .mock.calls.find(([e]) => e.kind === 'agent.run-failed');
    expect(failedEvent).toBeDefined();

    expect(mockAccumulatePersonaStats).toHaveBeenCalledWith({
      personaName: 'test-project/developer/0',
      role: 'developer',
      outcome: 'failure',
    });
  });

  it('emits skill-coaching.completed and success stat on happy path', async () => {
    const { runSkillCoachingWorkflow } = await import('./skill-coaching.js');
    const { eventStore } = await import('../event-stream/store.js');

    const validOutput = {
      skillName: 'investigate',
      diagnosis: 'Pattern: agents skip reading imports before mocking.',
      proposedPatch:
        '--- a/skills/investigate/skill.md\n+++ b/skills/investigate/skill.md\n@@ -5,3 +5,4 @@\n+Before mocking, read the file imports.\n',
      rationale: 'Clarifies read-before-mock discipline that 6 lifecycles violated.',
      evidencePatternIds: ['p1', 'p2'],
      confidence: 'high',
      decisionSummaries: [{ kind: 'PLAN', summary: 'Synthesized 2 patterns into minimal patch' }],
    };
    mockRun.mockResolvedValueOnce({ output: validOutput, decisionSummaries: [], events: [] });

    await runSkillCoachingWorkflow({
      projectId: 'test-project',
      targetSkillName: 'investigate',
      patternIds: ['p1', 'p2'],
    });

    const completedEvent = vi
      .mocked(eventStore.appendEvent)
      .mock.calls.find(([e]) => e.kind === 'skill-coaching.completed');
    expect(completedEvent).toBeDefined();

    const payload = completedEvent?.[0].payload as { targetSkillName: string };
    expect(payload.targetSkillName).toBe('investigate');

    expect(mockAccumulatePersonaStats).toHaveBeenCalledWith({
      personaName: 'test-project/developer/0',
      role: 'developer',
      outcome: 'success',
    });
  });

  it('emits agent.run-failed with clear error when skill source files are missing', async () => {
    const { runSkillCoachingWorkflow } = await import('./skill-coaching.js');
    const { eventStore } = await import('../event-stream/store.js');

    mockReadFileSync.mockImplementationOnce(() => {
      throw new Error('ENOENT: no such file or directory');
    });

    await runSkillCoachingWorkflow({
      projectId: 'test-project',
      targetSkillName: 'nonexistent-skill',
      patternIds: ['p1'],
    });

    const failedEvent = vi
      .mocked(eventStore.appendEvent)
      .mock.calls.find(([e]) => e.kind === 'agent.run-failed');
    expect(failedEvent).toBeDefined();

    const payload = failedEvent?.[0].payload as { skill: string; error: string };
    expect(payload.error).toContain('nonexistent-skill');
    expect(mockRun).not.toHaveBeenCalled();

    expect(mockAccumulatePersonaStats).toHaveBeenCalledWith(
      expect.objectContaining({
        role: 'developer',
        outcome: 'failure',
      }),
    );
  });
});
