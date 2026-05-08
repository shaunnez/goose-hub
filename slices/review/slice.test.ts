import type { AgentResult } from '@goose-hub/core/agent-runtime/interface.js';
import type { StateSource, WorkItem } from '@goose-hub/core/state-source/interface.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ─── module mocks ─────────────────────────────────────────────────────────────

const mockRun = vi.fn();
const mockAccumulatePersonaStats = vi.fn();
vi.mock('@goose-hub/core/persona/accumulate.js', () => ({
  accumulatePersonaStats: (...args: unknown[]) => mockAccumulatePersonaStats(...args),
}));

vi.mock('@goose-hub/core/agent-runtime/claude-cli.js', () => ({
  ClaudeCliRuntime: vi.fn().mockImplementation(() => ({ run: mockRun })),
}));

vi.mock('@goose-hub/core/agent-runtime/schema-bridge.js', () => ({
  toJsonSchema: vi.fn().mockReturnValue({}),
}));

vi.mock('@goose-hub/core/agent-runtime/select-persona.js', () => ({
  selectPersona: vi
    .fn()
    .mockReturnValue({ personaId: 'test-project/reviewer/0', codename: 'Grey Honker' }),
}));

const mockReplay = vi.fn().mockReturnValue([]);

vi.mock('@goose-hub/core/event-stream/store.js', () => ({
  eventStore: {
    appendEvent: vi
      .fn()
      .mockReturnValue({ id: 1, kind: 'review.completed', payload: {}, createdAt: '' }),
    replay: (...args: unknown[]) => mockReplay(...args),
  },
}));

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return { ...actual, readFileSync: vi.fn().mockReturnValue('# mock prompt') };
});

const mockExecSync = vi.fn().mockReturnValue('');
vi.mock('node:child_process', () => ({ execSync: (...args: unknown[]) => mockExecSync(...args) }));

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
    state: 'factory:needs-review',
    authorIsOwner: true,
    schedule: 'current',
    exec: 'serial',
    dependsOn: [],
    blocks: [],
    createdAt: new Date(),
    ...overrides,
  };
}

function makeApprovedResult(): AgentResult {
  return {
    output: {
      verdict: 'approved',
      confidence: 0.9,
      criteriaChecks: [{ criterion: 'Add foo', status: 'met' }],
      findings: [],
      decisionSummaries: [],
    },
    decisionSummaries: [],
    events: [],
  };
}

function makeNeedsFixResult(): AgentResult {
  return {
    output: {
      verdict: 'needs-fix',
      confidence: 0.7,
      criteriaChecks: [{ criterion: 'Add foo', status: 'unmet' }],
      findings: [
        {
          severity: 'blocker',
          description: 'not implemented',
          disposition: 'registered',
          dispositionRef: '#999',
        },
      ],
      decisionSummaries: [],
    },
    decisionSummaries: [],
    events: [],
  };
}

function makeNeedsHumanResult(): AgentResult {
  return {
    output: {
      verdict: 'needs-human',
      confidence: 0.3,
      criteriaChecks: [],
      findings: [],
      decisionSummaries: [],
      escalationReason: 'spec is ambiguous',
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
    createMilestone: vi.fn(),
    updateMilestone: vi.fn(),
    deleteMilestone: vi.fn(),
    getPrDiff: vi.fn().mockResolvedValue(''),
    addLabels: vi.fn(),
    removeLabel: vi.fn(),
    listLabels: vi.fn().mockResolvedValue([]),
    watchForUpdates: vi.fn(),
    ...overrides,
  };
}

// ─── test setup ───────────────────────────────────────────────────────────────

beforeEach(() => {
  mockRun.mockReset();
  mockReplay.mockReset();
  mockReplay.mockReturnValue([]);
  mockExecSync.mockReset();
  mockExecSync.mockReturnValue('');
  mockAccumulatePersonaStats.mockClear();
  vi.clearAllMocks();
});

// ─── tests ────────────────────────────────────────────────────────────────────

describe('runReviewWorkflow', () => {
  describe('getPrDiff — stateSource with getPrDiff method', () => {
    it('calls stateSource.getPrDiff when the method exists', async () => {
      const item = makeWorkItem();
      const getPrDiff = vi.fn().mockResolvedValue('diff --git ...');
      const source = makeMockSource({ getPrDiff } as never);
      mockRun.mockResolvedValueOnce(makeApprovedResult());

      const { runReviewWorkflow } = await import('./workflow.js');
      await runReviewWorkflow(item, source, 'test-project', 'owner/repo');

      expect(getPrDiff).toHaveBeenCalledWith('42');
    });

    it('passes the prDiff from stateSource to the agent', async () => {
      const item = makeWorkItem();
      const getPrDiff = vi.fn().mockResolvedValue('diff --git a/foo.ts b/foo.ts\n+added line');
      const source = makeMockSource({ getPrDiff } as never);
      mockRun.mockResolvedValueOnce(makeApprovedResult());

      const { runReviewWorkflow } = await import('./workflow.js');
      await runReviewWorkflow(item, source, 'test-project', 'owner/repo');

      expect(getPrDiff).toHaveBeenCalledWith('42');
      const spec = mockRun.mock.calls[0][0] as { context: Record<string, unknown> };
      expect(spec.context.prDiff).toBe('diff --git a/foo.ts b/foo.ts\n+added line');
    });

    it('passes empty prDiff when stateSource returns empty string', async () => {
      const item = makeWorkItem();
      const source = makeMockSource();
      mockRun.mockResolvedValueOnce(makeApprovedResult());

      const { runReviewWorkflow } = await import('./workflow.js');
      await runReviewWorkflow(item, source, 'test-project', 'owner/repo');

      const spec = mockRun.mock.calls[0][0] as { context: Record<string, unknown> };
      expect(spec.context.prDiff).toBe('');
    });
  });

  describe('review output with decisionSummaries', () => {
    it('emits one agent.decision-summary per review decision summary', async () => {
      const item = makeWorkItem();
      const source = makeMockSource();
      const resultWithSummaries: AgentResult = {
        output: {
          verdict: 'approved',
          confidence: 0.9,
          criteriaChecks: [{ criterion: 'Add foo', status: 'met' }],
          findings: [],
          decisionSummaries: [
            { kind: 'CRITERIA_CHECK', summary: 'criteria met' },
            { kind: 'CRITERIA_CHECK', summary: 'no regressions' },
          ],
        },
        decisionSummaries: [],
        events: [],
      };
      mockRun.mockResolvedValueOnce(resultWithSummaries);

      const { runReviewWorkflow } = await import('./workflow.js');
      const { eventStore } = await import('@goose-hub/core/event-stream/store.js');
      await runReviewWorkflow(item, source, 'test-project', 'owner/repo');

      const decisionEvents = vi
        .mocked(eventStore.appendEvent)
        .mock.calls.filter(
          ([e]) =>
            e.kind === 'agent.decision-summary' &&
            (e.payload as { skill?: string }).skill === 'review',
        );
      expect(decisionEvents).toHaveLength(2);
    });
  });

  describe('buildReviewComment format', () => {
    it('formats approved comment with checkmarks and confidence', async () => {
      const item = makeWorkItem();
      const source = makeMockSource();
      mockRun.mockResolvedValueOnce(makeApprovedResult());

      const { runReviewWorkflow } = await import('./workflow.js');
      await runReviewWorkflow(item, source, 'test-project', 'owner/repo');

      const commentCall = vi.mocked(source.comment).mock.calls[0];
      const comment = commentCall[1];
      expect(comment).toContain('Approved');
      expect(comment).toContain('Confidence');
    });

    it('truncates findings to first 5 in comment', async () => {
      const item = makeWorkItem();
      const source = makeMockSource();
      const resultWith6Findings: AgentResult = {
        output: {
          verdict: 'needs-fix',
          confidence: 0.5,
          criteriaChecks: [{ criterion: 'Add foo', status: 'unmet' }],
          findings: [
            {
              severity: 'blocker',
              description: 'issue 1',
              disposition: 'registered',
              dispositionRef: '#1',
            },
            {
              severity: 'blocker',
              description: 'issue 2',
              disposition: 'registered',
              dispositionRef: '#2',
            },
            { severity: 'major', description: 'issue 3' },
            { severity: 'major', description: 'issue 4' },
            { severity: 'minor', description: 'issue 5' },
            { severity: 'minor', description: 'issue 6 should not appear' },
          ],
          decisionSummaries: [],
        },
        decisionSummaries: [],
        events: [],
      };
      mockRun.mockResolvedValueOnce(resultWith6Findings);

      const { runReviewWorkflow } = await import('./workflow.js');
      await runReviewWorkflow(item, source, 'test-project', 'owner/repo');

      const commentCall = vi.mocked(source.comment).mock.calls[0];
      const comment = commentCall[1];
      expect(comment).toContain('issue 5');
      expect(comment).not.toContain('issue 6');
    });

    it('uses needs-human fallback for unknown verdict (VERDICT_TO_STATE fallback)', async () => {
      const item = makeWorkItem();
      const source = makeMockSource();
      const unknownVerdictResult: AgentResult = {
        output: {
          verdict: 'unknown-future-verdict',
          confidence: 0.5,
          criteriaChecks: [],
          findings: [],
          decisionSummaries: [],
        },
        decisionSummaries: [],
        events: [],
      };
      mockRun.mockResolvedValueOnce(unknownVerdictResult);

      const { runReviewWorkflow } = await import('./workflow.js');
      await runReviewWorkflow(item, source, 'test-project', 'owner/repo');

      expect(source.transitionState).toHaveBeenCalledWith(
        '42',
        'factory:needs-review',
        'factory:needs-human',
      );
    });
  });

  describe('review output validation failure', () => {
    it('transitions to needs-human when review output schema validation fails', async () => {
      const item = makeWorkItem();
      const source = makeMockSource();
      mockRun.mockResolvedValueOnce({
        output: { bad: 'data', missing: 'required' },
        decisionSummaries: [],
        events: [],
      } satisfies AgentResult);

      const { runReviewWorkflow } = await import('./workflow.js');
      await runReviewWorkflow(item, source, 'test-project', 'owner/repo');

      expect(source.transitionState).toHaveBeenCalledWith(
        '42',
        'factory:needs-review',
        'factory:needs-human',
      );
    });
  });

  describe('approved verdict', () => {
    it('transitions state to factory:approved on approved verdict', async () => {
      const item = makeWorkItem();
      const source = makeMockSource();
      mockRun.mockResolvedValueOnce(makeApprovedResult());

      const { runReviewWorkflow } = await import('./workflow.js');
      await runReviewWorkflow(item, source, 'test-project', 'owner/repo');

      expect(source.transitionState).toHaveBeenCalledWith(
        '42',
        'factory:needs-review',
        'factory:approved',
      );
      expect(mockAccumulatePersonaStats).toHaveBeenCalledWith({
        personaName: 'test-project/reviewer/0',
        role: 'reviewer',
        outcome: 'success',
        qualityScore: 0.9,
      });
    });

    it('posts a comment on approved verdict', async () => {
      const item = makeWorkItem();
      const source = makeMockSource();
      mockRun.mockResolvedValueOnce(makeApprovedResult());

      const { runReviewWorkflow } = await import('./workflow.js');
      await runReviewWorkflow(item, source, 'test-project', 'owner/repo');

      expect(source.comment).toHaveBeenCalledWith('42', expect.any(String));
    });
  });

  describe('needs-fix verdict', () => {
    it('transitions state to factory:needs-fix on needs-fix verdict', async () => {
      const item = makeWorkItem();
      const source = makeMockSource();
      mockRun.mockResolvedValueOnce(makeNeedsFixResult());

      const { runReviewWorkflow } = await import('./workflow.js');
      await runReviewWorkflow(item, source, 'test-project', 'owner/repo');

      expect(source.transitionState).toHaveBeenCalledWith(
        '42',
        'factory:needs-review',
        'factory:needs-fix',
      );
      expect(mockAccumulatePersonaStats).toHaveBeenCalledWith({
        personaName: 'test-project/reviewer/0',
        role: 'reviewer',
        outcome: 'failure',
        qualityScore: 0.7,
      });
    });
  });

  describe('needs-human verdict', () => {
    it('transitions state to factory:needs-human on needs-human verdict', async () => {
      const item = makeWorkItem();
      const source = makeMockSource();
      mockRun.mockResolvedValueOnce(makeNeedsHumanResult());

      const { runReviewWorkflow } = await import('./workflow.js');
      await runReviewWorkflow(item, source, 'test-project', 'owner/repo');

      expect(source.transitionState).toHaveBeenCalledWith(
        '42',
        'factory:needs-review',
        'factory:needs-human',
      );
    });
  });

  describe('error path', () => {
    it('transitions to factory:needs-human on runtime error', async () => {
      const item = makeWorkItem();
      const source = makeMockSource();
      mockRun.mockRejectedValueOnce(new Error('Runtime exploded'));

      const { runReviewWorkflow } = await import('./workflow.js');
      await runReviewWorkflow(item, source, 'test-project', 'owner/repo');

      expect(source.transitionState).toHaveBeenCalledWith(
        '42',
        'factory:needs-review',
        'factory:needs-human',
      );
      expect(mockAccumulatePersonaStats).toHaveBeenCalledWith({
        personaName: 'test-project/reviewer/0',
        role: 'reviewer',
        outcome: 'failure',
      });
    });

    it('posts a comment with error message on runtime error', async () => {
      const item = makeWorkItem();
      const source = makeMockSource();
      mockRun.mockRejectedValueOnce(new Error('Runtime exploded'));

      const { runReviewWorkflow } = await import('./workflow.js');
      await runReviewWorkflow(item, source, 'test-project', 'owner/repo');

      expect(source.comment).toHaveBeenCalledWith(
        '42',
        expect.stringContaining('Runtime exploded'),
      );
    });
  });

  describe('AgentSpec fields', () => {
    it('uses role "reviewer" in AgentSpec', async () => {
      const item = makeWorkItem();
      const source = makeMockSource();
      mockRun.mockResolvedValueOnce(makeApprovedResult());

      const { runReviewWorkflow } = await import('./workflow.js');
      await runReviewWorkflow(item, source, 'test-project', 'owner/repo');

      const specUsed = mockRun.mock.calls[0][0] as { role: string };
      expect(specUsed.role).toBe('reviewer');
    });

    it('sets freshContext to true in AgentSpec', async () => {
      const item = makeWorkItem();
      const source = makeMockSource();
      mockRun.mockResolvedValueOnce(makeApprovedResult());

      const { runReviewWorkflow } = await import('./workflow.js');
      await runReviewWorkflow(item, source, 'test-project', 'owner/repo');

      const specUsed = mockRun.mock.calls[0][0] as { freshContext: boolean };
      expect(specUsed.freshContext).toBe(true);
    });

    it('contextAllowlist contains "workItem", "prDiff", and "qaVerdict" but NOT "devDecisionSummaries"', async () => {
      const item = makeWorkItem();
      const source = makeMockSource();
      mockRun.mockResolvedValueOnce(makeApprovedResult());

      const { runReviewWorkflow } = await import('./workflow.js');
      await runReviewWorkflow(item, source, 'test-project', 'owner/repo');

      const specUsed = mockRun.mock.calls[0][0] as { contextAllowlist: string[] };
      expect(specUsed.contextAllowlist).toContain('workItem');
      expect(specUsed.contextAllowlist).toContain('prDiff');
      expect(specUsed.contextAllowlist).toContain('qaVerdict');
      expect(specUsed.contextAllowlist).not.toContain('devDecisionSummaries');
    });
  });

  describe('retry-and-escalate', () => {
    it('transitions to factory:needs-human and emits agent.retry-escalated when review needs-fix count >= maxRetries', async () => {
      const item = makeWorkItem();
      const source = makeMockSource();
      mockRun.mockResolvedValueOnce(makeNeedsFixResult());
      // Simulate 2 prior review.completed needs-fix events already in the store
      mockReplay.mockReturnValue([
        {
          kind: 'review.completed',
          payload: JSON.stringify({ verdict: 'needs-fix', confidence: 0.7 }),
        },
        {
          kind: 'review.completed',
          payload: JSON.stringify({ verdict: 'needs-fix', confidence: 0.6 }),
        },
      ]);

      const { runReviewWorkflow } = await import('./workflow.js');
      const { eventStore } = await import('@goose-hub/core/event-stream/store.js');
      await runReviewWorkflow(item, source, 'test-project', 'owner/repo');

      expect(source.transitionState).toHaveBeenCalledWith(
        '42',
        'factory:needs-review',
        'factory:needs-human',
      );
      expect(eventStore.appendEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'agent.retry-escalated',
          payload: expect.objectContaining({ stage: 'review' }),
        }),
      );
    });

    it('transitions to factory:needs-fix when review needs-fix count < maxRetries', async () => {
      const item = makeWorkItem();
      const source = makeMockSource();
      mockRun.mockResolvedValueOnce(makeNeedsFixResult());
      // Only 1 prior review.completed needs-fix event — under the maxRetries threshold
      mockReplay.mockReturnValue([
        {
          kind: 'review.completed',
          payload: JSON.stringify({ verdict: 'needs-fix', confidence: 0.7 }),
        },
      ]);

      const { runReviewWorkflow } = await import('./workflow.js');
      await runReviewWorkflow(item, source, 'test-project', 'owner/repo');

      expect(source.transitionState).toHaveBeenCalledWith(
        '42',
        'factory:needs-review',
        'factory:needs-fix',
      );
    });
  });

  describe('getQaVerdict — reads qa.completed from event store', () => {
    it('passes qaVerdict with verdict and overallScore when qa.completed event exists', async () => {
      const item = makeWorkItem();
      const source = makeMockSource();
      mockRun.mockResolvedValueOnce(makeApprovedResult());
      mockReplay.mockReturnValue([
        {
          kind: 'qa.completed',
          payload: { verdict: 'pass', overallScore: 88 },
          workItemId: item.id,
        },
      ]);

      const { runReviewWorkflow } = await import('./workflow.js');
      await runReviewWorkflow(item, source, 'test-project', 'owner/repo');

      const spec = mockRun.mock.calls[0][0] as { context: Record<string, unknown> };
      expect(spec.context.qaVerdict).toEqual({ verdict: 'pass', overallScore: 88 });
    });

    it('uses the last qa.completed when multiple exist', async () => {
      const item = makeWorkItem();
      const source = makeMockSource();
      mockRun.mockResolvedValueOnce(makeApprovedResult());
      mockReplay.mockReturnValue([
        {
          kind: 'qa.completed',
          payload: { verdict: 'fail', overallScore: 45 },
          workItemId: item.id,
        },
        {
          kind: 'qa.completed',
          payload: { verdict: 'pass', overallScore: 92 },
          workItemId: item.id,
        },
      ]);

      const { runReviewWorkflow } = await import('./workflow.js');
      await runReviewWorkflow(item, source, 'test-project', 'owner/repo');

      const spec = mockRun.mock.calls[0][0] as { context: Record<string, unknown> };
      expect(spec.context.qaVerdict).toEqual({ verdict: 'pass', overallScore: 92 });
    });

    it('passes undefined qaVerdict when no qa.completed event exists', async () => {
      const item = makeWorkItem();
      const source = makeMockSource();
      mockRun.mockResolvedValueOnce(makeApprovedResult());
      mockReplay.mockReturnValue([]);

      const { runReviewWorkflow } = await import('./workflow.js');
      await runReviewWorkflow(item, source, 'test-project', 'owner/repo');

      const spec = mockRun.mock.calls[0][0] as { context: Record<string, unknown> };
      expect(spec.context.qaVerdict).toBeUndefined();
    });

    it('handles string-serialized payload (legacy mock compatibility)', async () => {
      const item = makeWorkItem();
      const source = makeMockSource();
      mockRun.mockResolvedValueOnce(makeApprovedResult());
      mockReplay.mockReturnValue([
        {
          kind: 'qa.completed',
          payload: JSON.stringify({ verdict: 'partial', overallScore: 72 }),
          workItemId: item.id,
        },
      ]);

      const { runReviewWorkflow } = await import('./workflow.js');
      await runReviewWorkflow(item, source, 'test-project', 'owner/repo');

      const spec = mockRun.mock.calls[0][0] as { context: Record<string, unknown> };
      expect(spec.context.qaVerdict).toEqual({ verdict: 'partial', overallScore: 72 });
    });
  });

  describe('non-Error thrown (line 127 branch)', () => {
    it('wraps non-Error thrown value as Error and transitions to needs-human', async () => {
      const item = makeWorkItem();
      const source = makeMockSource();
      // Throw a string instead of an Error object — covers line 127
      // eslint-disable-next-line prefer-promise-reject-errors
      mockRun.mockRejectedValueOnce('string error from review runtime');

      const { runReviewWorkflow } = await import('./workflow.js');
      await runReviewWorkflow(item, source, 'test-project', 'owner/repo');

      expect(source.transitionState).toHaveBeenCalledWith(
        '42',
        'factory:needs-review',
        'factory:needs-human',
      );
      expect(source.comment).toHaveBeenCalledWith(
        '42',
        expect.stringContaining('string error from review runtime'),
      );
    });
  });
});
