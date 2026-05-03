import type { AgentResult } from '@goose-hub/core/agent-runtime/interface.js';
import type { StateSource, WorkItem } from '@goose-hub/core/state-source/interface.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ─── module mocks ─────────────────────────────────────────────────────────────

const mockRun = vi.fn();

vi.mock('@goose-hub/core/agent-runtime/claude-cli.js', () => ({
  ClaudeCliRuntime: vi.fn().mockImplementation(() => ({ run: mockRun })),
}));

vi.mock('@goose-hub/core/agent-runtime/schema-bridge.js', () => ({
  toJsonSchema: vi.fn().mockReturnValue({}),
}));

vi.mock('@goose-hub/core/agent-runtime/select-persona.js', () => ({
  selectPersona: vi.fn().mockReturnValue('test-project/qa/0'),
}));

const mockReplay = vi.fn().mockReturnValue([]);

vi.mock('@goose-hub/core/event-stream/store.js', () => ({
  eventStore: {
    appendEvent: vi
      .fn()
      .mockReturnValue({ id: 1, kind: 'qa.completed', payload: {}, createdAt: '' }),
    replay: (...args: unknown[]) => mockReplay(...args),
  },
}));

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return { ...actual, readFileSync: vi.fn().mockReturnValue('# mock prompt') };
});

// ─── helpers ─────────────────────────────────────────────────────────────────

function makeWorkItem(overrides: Partial<WorkItem> = {}): WorkItem {
  return {
    id: 'github:owner/repo#42',
    externalId: '42',
    repoRef: 'owner/repo',
    title: 'Test issue',
    body: '## Acceptance criteria\n- [ ] Add foo',
    type: 'feature',
    priority: 'medium',
    mode: 'supervised',
    state: 'factory:needs-qa',
    authorIsOwner: true,
    schedule: 'current',
    exec: 'serial',
    dependsOn: [],
    blocks: [],
    createdAt: new Date(),
    ...overrides,
  };
}

function makePassResult(): AgentResult {
  return {
    output: {
      verdict: 'pass',
      overallScore: 85,
      threshold: 70,
      tierResults: {
        structural: { passed: true, findings: [] },
        functional: { passed: true, findings: [] },
        regression: { passed: true, findings: [] },
      },
      qualityScores: {
        openClosed: 17,
        conceptCount: 12,
        timeToCapability: 13,
        complecting: 14,
        loc: 9,
        coupling: 9,
        gallsLaw: 9,
        cyclomaticComplexity: 4,
      },
      findings: [],
      decisionSummaries: [],
    },
    decisionSummaries: [],
    events: [],
  };
}

function makeFailResult(): AgentResult {
  return {
    output: {
      verdict: 'fail',
      overallScore: 45,
      threshold: 70,
      tierResults: {
        structural: {
          passed: false,
          findings: [{ tier: 'structural', severity: 'error', description: 'lint error' }],
        },
        functional: { passed: false, findings: [] },
        regression: { passed: true, findings: [] },
      },
      qualityScores: {
        openClosed: 5,
        conceptCount: 5,
        timeToCapability: 5,
        complecting: 5,
        loc: 5,
        coupling: 5,
        gallsLaw: 5,
        cyclomaticComplexity: 4,
      },
      findings: [],
      decisionSummaries: [],
    },
    decisionSummaries: [],
    events: [],
  };
}

function makePartialHighResult(): AgentResult {
  return {
    output: {
      verdict: 'partial',
      overallScore: 72,
      threshold: 70,
      tierResults: {
        structural: { passed: true, findings: [] },
        functional: { passed: false, findings: [] },
        regression: { passed: true, findings: [] },
      },
      qualityScores: {
        openClosed: 15,
        conceptCount: 10,
        timeToCapability: 12,
        complecting: 12,
        loc: 7,
        coupling: 7,
        gallsLaw: 7,
        cyclomaticComplexity: 2,
      },
      findings: [],
      decisionSummaries: [],
    },
    decisionSummaries: [],
    events: [],
  };
}

function makePartialLowResult(): AgentResult {
  return {
    output: {
      verdict: 'partial',
      overallScore: 65,
      threshold: 70,
      tierResults: {
        structural: { passed: false, findings: [] },
        functional: { passed: false, findings: [] },
        regression: { passed: true, findings: [] },
      },
      qualityScores: {
        openClosed: 10,
        conceptCount: 8,
        timeToCapability: 10,
        complecting: 10,
        loc: 6,
        coupling: 6,
        gallsLaw: 6,
        cyclomaticComplexity: 5,
      },
      findings: [],
      decisionSummaries: [],
    },
    decisionSummaries: [],
    events: [],
  };
}

function makeMockSource(overrides: Partial<StateSource> = {}): StateSource {
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

// ─── test setup ───────────────────────────────────────────────────────────────

beforeEach(() => {
  mockRun.mockReset();
  mockReplay.mockReset();
  mockReplay.mockReturnValue([]);
  vi.clearAllMocks();
});

// ─── tests ────────────────────────────────────────────────────────────────────

describe('runQaWorkflow', () => {
  describe('pass verdict', () => {
    it('transitions state to factory:needs-review on pass', async () => {
      const item = makeWorkItem();
      const source = makeMockSource();
      mockRun.mockResolvedValueOnce(makePassResult());

      const { runQaWorkflow } = await import('./workflow.js');
      await runQaWorkflow(item, source, 'test-project', 'owner/repo');

      expect(source.transitionState).toHaveBeenCalledWith(
        '42',
        'factory:needs-qa',
        'factory:needs-review',
      );
    });

    it('posts a comment on pass verdict', async () => {
      const item = makeWorkItem();
      const source = makeMockSource();
      mockRun.mockResolvedValueOnce(makePassResult());

      const { runQaWorkflow } = await import('./workflow.js');
      await runQaWorkflow(item, source, 'test-project', 'owner/repo');

      expect(source.comment).toHaveBeenCalledWith('42', expect.any(String));
    });
  });

  describe('fail verdict', () => {
    it('transitions state to factory:qa-failed on fail', async () => {
      const item = makeWorkItem();
      const source = makeMockSource();
      mockRun.mockResolvedValueOnce(makeFailResult());

      const { runQaWorkflow } = await import('./workflow.js');
      await runQaWorkflow(item, source, 'test-project', 'owner/repo');

      expect(source.transitionState).toHaveBeenCalledWith(
        '42',
        'factory:needs-qa',
        'factory:qa-failed',
      );
    });
  });

  describe('error path', () => {
    it('transitions to factory:needs-human on runtime error', async () => {
      const item = makeWorkItem();
      const source = makeMockSource();
      mockRun.mockRejectedValueOnce(new Error('Runtime exploded'));

      const { runQaWorkflow } = await import('./workflow.js');
      await runQaWorkflow(item, source, 'test-project', 'owner/repo');

      expect(source.transitionState).toHaveBeenCalledWith(
        '42',
        'factory:needs-qa',
        'factory:needs-human',
      );
    });

    it('posts a comment with error message on runtime error', async () => {
      const item = makeWorkItem();
      const source = makeMockSource();
      mockRun.mockRejectedValueOnce(new Error('Runtime exploded'));

      const { runQaWorkflow } = await import('./workflow.js');
      await runQaWorkflow(item, source, 'test-project', 'owner/repo');

      expect(source.comment).toHaveBeenCalledWith(
        '42',
        expect.stringContaining('Runtime exploded'),
      );
    });
  });

  describe('AgentSpec fields', () => {
    it('uses role "qa" in AgentSpec', async () => {
      const item = makeWorkItem();
      const source = makeMockSource();
      mockRun.mockResolvedValueOnce(makePassResult());

      const { runQaWorkflow } = await import('./workflow.js');
      await runQaWorkflow(item, source, 'test-project', 'owner/repo');

      const specUsed = mockRun.mock.calls[0][0] as { role: string };
      expect(specUsed.role).toBe('qa');
    });

    it('sets freshContext to true in AgentSpec', async () => {
      const item = makeWorkItem();
      const source = makeMockSource();
      mockRun.mockResolvedValueOnce(makePassResult());

      const { runQaWorkflow } = await import('./workflow.js');
      await runQaWorkflow(item, source, 'test-project', 'owner/repo');

      const specUsed = mockRun.mock.calls[0][0] as { freshContext: boolean };
      expect(specUsed.freshContext).toBe(true);
    });

    it('contextAllowlist contains "workItem" and "prDiff" but NOT "devDecisionSummaries"', async () => {
      const item = makeWorkItem();
      const source = makeMockSource();
      mockRun.mockResolvedValueOnce(makePassResult());

      const { runQaWorkflow } = await import('./workflow.js');
      await runQaWorkflow(item, source, 'test-project', 'owner/repo');

      const specUsed = mockRun.mock.calls[0][0] as { contextAllowlist: string[] };
      expect(specUsed.contextAllowlist).toContain('workItem');
      expect(specUsed.contextAllowlist).toContain('prDiff');
      expect(specUsed.contextAllowlist).not.toContain('devDecisionSummaries');
    });
  });

  describe('partial verdict', () => {
    it('transitions to factory:needs-review when partial score >= 70', async () => {
      const item = makeWorkItem();
      const source = makeMockSource();
      mockRun.mockResolvedValueOnce(makePartialHighResult());

      const { runQaWorkflow } = await import('./workflow.js');
      await runQaWorkflow(item, source, 'test-project', 'owner/repo');

      expect(source.transitionState).toHaveBeenCalledWith(
        '42',
        'factory:needs-qa',
        'factory:needs-review',
      );
    });

    it('transitions to factory:qa-failed when partial score < 70', async () => {
      const item = makeWorkItem();
      const source = makeMockSource();
      mockRun.mockResolvedValueOnce(makePartialLowResult());

      const { runQaWorkflow } = await import('./workflow.js');
      await runQaWorkflow(item, source, 'test-project', 'owner/repo');

      expect(source.transitionState).toHaveBeenCalledWith(
        '42',
        'factory:needs-qa',
        'factory:qa-failed',
      );
    });
  });

  describe('retry-and-escalate', () => {
    it('transitions to factory:needs-human and emits agent.retry-escalated when qa-fail count >= maxRetries', async () => {
      const item = makeWorkItem();
      const source = makeMockSource();
      mockRun.mockResolvedValueOnce(makeFailResult());
      // Simulate 2 prior qa.completed fail events already in the store
      mockReplay.mockReturnValue([
        { kind: 'qa.completed', payload: JSON.stringify({ verdict: 'fail', overallScore: 40 }) },
        { kind: 'qa.completed', payload: JSON.stringify({ verdict: 'fail', overallScore: 35 }) },
      ]);

      const { runQaWorkflow } = await import('./workflow.js');
      const { eventStore } = await import('@goose-hub/core/event-stream/store.js');
      await runQaWorkflow(item, source, 'test-project', 'owner/repo');

      expect(source.transitionState).toHaveBeenCalledWith(
        '42',
        'factory:needs-qa',
        'factory:needs-human',
      );
      expect(eventStore.appendEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'agent.retry-escalated',
          payload: expect.objectContaining({ stage: 'qa' }),
        }),
      );
    });

    it('transitions to factory:qa-failed when qa-fail count < maxRetries', async () => {
      const item = makeWorkItem();
      const source = makeMockSource();
      mockRun.mockResolvedValueOnce(makeFailResult());
      // Only 1 prior qa.completed fail event — under the maxRetries threshold
      mockReplay.mockReturnValue([
        { kind: 'qa.completed', payload: JSON.stringify({ verdict: 'fail', overallScore: 40 }) },
      ]);

      const { runQaWorkflow } = await import('./workflow.js');
      await runQaWorkflow(item, source, 'test-project', 'owner/repo');

      expect(source.transitionState).toHaveBeenCalledWith(
        '42',
        'factory:needs-qa',
        'factory:qa-failed',
      );
    });
  });
});
