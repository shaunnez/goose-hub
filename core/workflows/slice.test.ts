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
  selectPersona: vi.fn().mockReturnValue({ personaId: 'test-project/retrospector/0', codename: 'Grey Honker' }),
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
  return { ...actual, readFileSync: vi.fn().mockReturnValue('# mock skill prompt') };
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
    watchForUpdates: vi.fn(),
    ...overrides,
  };
}

function makeLightResult() {
  return {
    output: {
      summary: '- All good.\n- No issues.\n- Keep it up.',
      improvementCandidates: [],
      decisionSummaries: [{ step: 'retro-complete', summary: 'Clean run' }],
    },
    decisionSummaries: [],
    events: [],
  };
}

function makeDeepResult() {
  return {
    output: {
      summary: '- Good.\n- QA failed once.\n- Adjust prompt.',
      personaAnalysis: [],
      learningEntries: [],
      decisionPatterns: [],
      improvementCandidates: [],
      decisionSummaries: [{ step: 'retro-complete', summary: 'Deep retro complete' }],
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
});
