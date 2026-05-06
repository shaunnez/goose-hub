import { beforeEach, describe, expect, it, vi } from 'vitest';

// ─── module mocks ─────────────────────────────────────────────────────────────

const mockRun = vi.fn();
const mockAppendEvent = vi.fn();
const mockDbInsert = vi.fn().mockReturnValue({
  values: vi.fn().mockReturnValue({
    run: vi.fn(),
  }),
});

vi.mock('../agent-runtime/claude-cli.js', () => ({
  ClaudeCliRuntime: vi.fn().mockImplementation(() => ({ run: mockRun })),
}));
vi.mock('../event-stream/store.js', () => ({
  eventStore: {
    appendEvent: (...args: unknown[]) => mockAppendEvent(...args),
  },
}));
vi.mock('../agent-runtime/select-persona.js', () => ({
  selectPersona: vi.fn().mockReturnValue({ personaId: 'test-project/coach/0' }),
}));
vi.mock('../db/db.js', () => ({
  db: {
    insert: mockDbInsert,
  },
}));
vi.mock('../logger.js', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
  },
}));

// ─── helpers ─────────────────────────────────────────────────────────────────

type CoachPolicy = {
  enabled: boolean;
  consistencyThreshold: number;
  minLifecycles: number;
  forbiddenTargets?: string[];
};

interface Candidate {
  id: number;
  kind: string;
  targetPath: string;
  suggestionText: string;
  consistencyScore: number;
  lifecycleCount: number;
}

function makeCoachPolicy(overrides: Partial<CoachPolicy> = {}): CoachPolicy {
  return {
    enabled: false,
    consistencyThreshold: 0.8,
    minLifecycles: 3,
    forbiddenTargets: [],
    ...overrides,
  };
}

function makeCandidate(overrides: Partial<Candidate> = {}): Candidate {
  return {
    id: 1,
    kind: 'skill-prompt',
    targetPath: 'skills/triage/prompt.md',
    suggestionText: 'Improve triage prompt',
    consistencyScore: 0.85,
    lifecycleCount: 5,
    ...overrides,
  };
}

function makeCoachResult(overrides: Record<string, unknown> = {}) {
  return {
    output: {
      outcome: 'success',
      candidates: [],
      decisionSummaries: [{ kind: 'VERDICT', summary: 'Coach run complete' }],
      ...overrides,
    },
  };
}

beforeEach(() => {
  mockRun.mockReset();
  mockAppendEvent.mockClear();
  mockDbInsert.mockClear();
  mockDbInsert.mockReturnValue({
    values: vi.fn().mockReturnValue({
      run: vi.fn(),
    }),
  });
  vi.clearAllMocks();
});

// ─── scenarios ─────────────────────────────────────────────────────────────────

describe('scanAndDispatchCoach', () => {
  it('fires when enabled flag is true', async () => {
    const { scanAndDispatchCoach } = await import('./coach-dispatch.js');
    const policy = makeCoachPolicy({ enabled: true });
    const candidates = [makeCandidate()];
    mockRun.mockResolvedValueOnce(makeCoachResult());

    await scanAndDispatchCoach({
      projectId: 'test-project',
      playbookId: 'playbook-1',
      candidates,
      coachPolicy: policy,
    });

    expect(mockRun).toHaveBeenCalled();
  });

  it('skips dispatch when enabled flag is false', async () => {
    const { scanAndDispatchCoach } = await import('./coach-dispatch.js');
    const policy = makeCoachPolicy({ enabled: false });
    const candidates = [makeCandidate()];

    await scanAndDispatchCoach({
      projectId: 'test-project',
      playbookId: 'playbook-1',
      candidates,
      coachPolicy: policy,
    });

    expect(mockRun).not.toHaveBeenCalled();
  });

  it('filters candidates by kind (skill-prompt, skill-schema, skill-config only)', async () => {
    const { scanAndDispatchCoach } = await import('./coach-dispatch.js');
    const policy = makeCoachPolicy({ enabled: true });
    const candidates = [
      makeCandidate({ kind: 'skill-prompt' }),
      makeCandidate({ kind: 'skill-schema' }),
      makeCandidate({ kind: 'skill-config' }),
      makeCandidate({ kind: 'workflow' }),
      makeCandidate({ kind: 'global-config' }),
    ];
    mockRun.mockResolvedValueOnce(makeCoachResult());

    await scanAndDispatchCoach({
      projectId: 'test-project',
      playbookId: 'playbook-1',
      candidates,
      coachPolicy: policy,
    });

    // Only 3 skill-related candidates should be dispatched
    expect(mockRun.mock.calls.length).toBe(3);
  });

  it('filters candidates by consistencyScore >= threshold', async () => {
    const { scanAndDispatchCoach } = await import('./coach-dispatch.js');
    const policy = makeCoachPolicy({ enabled: true, consistencyThreshold: 0.8 });
    const candidates = [
      makeCandidate({ id: 1, consistencyScore: 0.9 }),
      makeCandidate({ id: 2, consistencyScore: 0.8 }),
      makeCandidate({ id: 3, consistencyScore: 0.79 }),
      makeCandidate({ id: 4, consistencyScore: 0.75 }),
    ];
    mockRun.mockResolvedValue(makeCoachResult());

    await scanAndDispatchCoach({
      projectId: 'test-project',
      playbookId: 'playbook-1',
      candidates,
      coachPolicy: policy,
    });

    // Only first two candidates meet threshold
    expect(mockRun.mock.calls.length).toBe(2);
  });

  it('filters candidates by minLifecycles', async () => {
    const { scanAndDispatchCoach } = await import('./coach-dispatch.js');
    const policy = makeCoachPolicy({ enabled: true, minLifecycles: 3 });
    const candidates = [
      makeCandidate({ id: 1, lifecycleCount: 5 }),
      makeCandidate({ id: 2, lifecycleCount: 3 }),
      makeCandidate({ id: 3, lifecycleCount: 2 }),
      makeCandidate({ id: 4, lifecycleCount: 1 }),
    ];
    mockRun.mockResolvedValue(makeCoachResult());

    await scanAndDispatchCoach({
      projectId: 'test-project',
      playbookId: 'playbook-1',
      candidates,
      coachPolicy: policy,
    });

    // Only first two candidates meet minLifecycles
    expect(mockRun.mock.calls.length).toBe(2);
  });

  it('skips candidates matching forbidden targets', async () => {
    const { scanAndDispatchCoach } = await import('./coach-dispatch.js');
    const policy = makeCoachPolicy({
      enabled: true,
      forbiddenTargets: ['skills/triage/prompt.md', 'skills/qa/prompt.md'],
    });
    const candidates = [
      makeCandidate({ id: 1, targetPath: 'skills/triage/prompt.md' }),
      makeCandidate({ id: 2, targetPath: 'skills/qa/prompt.md' }),
      makeCandidate({ id: 3, targetPath: 'skills/developer/prompt.md' }),
    ];
    mockRun.mockResolvedValue(makeCoachResult());

    await scanAndDispatchCoach({
      projectId: 'test-project',
      playbookId: 'playbook-1',
      candidates,
      coachPolicy: policy,
    });

    expect(mockRun).toHaveBeenCalledTimes(1);
  });

  it('emits coach.skipped-forbidden-target event for skipped candidates', async () => {
    const { scanAndDispatchCoach } = await import('./coach-dispatch.js');
    const policy = makeCoachPolicy({
      enabled: true,
      forbiddenTargets: ['skills/triage/prompt.md'],
    });
    const candidates = [
      makeCandidate({ id: 1, targetPath: 'skills/triage/prompt.md' }),
      makeCandidate({ id: 2, targetPath: 'skills/qa/prompt.md', lifecycleCount: 2 }),
    ];
    mockRun.mockResolvedValue(makeCoachResult());

    await scanAndDispatchCoach({
      projectId: 'test-project',
      playbookId: 'playbook-1',
      candidates,
      coachPolicy: policy,
    });

    const skippedEvent = mockAppendEvent.mock.calls.find(([e]: unknown[]) => {
      const event = e as Record<string, unknown>;
      return event.kind === 'coach.skipped-forbidden-target';
    });
    expect(skippedEvent).toBeDefined();
  });

  it('dispatches coach with patternIds and lifecycleIds', async () => {
    const { scanAndDispatchCoach } = await import('./coach-dispatch.js');
    const policy = makeCoachPolicy({ enabled: true });
    const candidates = [
      makeCandidate({ id: 1, lifecycleCount: 5 }),
      makeCandidate({ id: 2, lifecycleCount: 4 }),
    ];
    mockRun.mockResolvedValue(makeCoachResult());

    await scanAndDispatchCoach({
      projectId: 'test-project',
      playbookId: 'playbook-1',
      candidates,
      coachPolicy: policy,
    });

    expect(mockRun).toHaveBeenCalledTimes(2);
    const spec = mockRun.mock.calls[0][0] as Record<string, unknown>;
    expect(spec.skill).toBe('skill-coach');
    expect(spec.context).toHaveProperty('patternIds');
    expect(spec.context).toHaveProperty('lifecycleIds');
  });

  it('persists coach output candidates with sourcePlaybookId', async () => {
    const { scanAndDispatchCoach } = await import('./coach-dispatch.js');
    const policy = makeCoachPolicy({ enabled: true });
    const candidates = [makeCandidate()];
    const coachCandidates = [
      {
        kind: 'skill-prompt',
        targetPath: 'skills/triage/prompt.md',
        suggestionText: 'Coach suggestion',
        confidence: 'high',
      },
    ];
    mockRun.mockResolvedValueOnce(makeCoachResult({ candidates: coachCandidates }));

    await scanAndDispatchCoach({
      projectId: 'test-project',
      playbookId: 'playbook-1',
      candidates,
      coachPolicy: policy,
    });

    // Check that candidates were persisted with sourcePlaybookId
    const persistedEvent = mockAppendEvent.mock.calls.find(([e]: unknown[]) => {
      const event = e as Record<string, unknown>;
      return event.kind === 'coach.candidates-persisted';
    });
    expect(persistedEvent).toBeDefined();
  });

  it('combines all filters: kind + consistency + minLifecycles + forbidden', async () => {
    const { scanAndDispatchCoach } = await import('./coach-dispatch.js');
    const policy = makeCoachPolicy({
      enabled: true,
      consistencyThreshold: 0.8,
      minLifecycles: 3,
      forbiddenTargets: ['skills/triage/prompt.md'],
    });
    const candidates = [
      // Filtered out: forbidden
      makeCandidate({
        id: 1,
        kind: 'skill-prompt',
        targetPath: 'skills/triage/prompt.md',
        consistencyScore: 0.9,
        lifecycleCount: 5,
      }),
      // Filtered out: consistency too low
      makeCandidate({
        id: 2,
        kind: 'skill-prompt',
        targetPath: 'skills/qa/prompt.md',
        consistencyScore: 0.7,
        lifecycleCount: 5,
      }),
      // Filtered out: minLifecycles not met
      makeCandidate({
        id: 3,
        kind: 'skill-prompt',
        targetPath: 'skills/developer/prompt.md',
        consistencyScore: 0.9,
        lifecycleCount: 2,
      }),
      // Filtered out: wrong kind
      makeCandidate({
        id: 4,
        kind: 'workflow',
        targetPath: 'core/workflows/test.ts',
        consistencyScore: 0.9,
        lifecycleCount: 5,
      }),
      // MATCH: passes all filters
      makeCandidate({
        id: 5,
        kind: 'skill-schema',
        targetPath: 'skills/grill/schema.ts',
        consistencyScore: 0.85,
        lifecycleCount: 4,
      }),
    ];
    mockRun.mockResolvedValue(makeCoachResult());

    await scanAndDispatchCoach({
      projectId: 'test-project',
      playbookId: 'playbook-1',
      candidates,
      coachPolicy: policy,
    });

    expect(mockRun).toHaveBeenCalledTimes(1);
    const skippedEvents = mockAppendEvent.mock.calls.filter(([e]: unknown[]) => {
      const event = e as Record<string, unknown>;
      return event.kind === 'coach.skipped-forbidden-target';
    });
    expect(skippedEvents.length).toBeGreaterThanOrEqual(1);
  });
});
