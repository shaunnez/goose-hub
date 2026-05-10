import type { AgentResult, AgentSpec } from '@goose-hub/core/agent-runtime/interface.js';
import type { StateSource, WorkItem } from '@goose-hub/core/state-source/interface.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ─── module mocks ─────────────────────────────────────────────────────────────

vi.mock('@goose-hub/core/db/repositories/project-settings.js', () => ({
  readProjectSettings: vi.fn().mockReturnValue(null),
  readProjectSkillSettings: vi.fn().mockReturnValue(new Map()),
}));
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

// ─── Convergent review (M19.04) ───────────────────────────────────────────────

function makeCriticalResult(description: string): AgentResult {
  return {
    output: {
      verdict: 'needs-fix',
      confidence: 0.6,
      criteriaChecks: [],
      findings: [
        {
          severity: 'blocker',
          description,
          file: 'src/foo.ts',
          line: 1,
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

function makeApprovedResultNoFindings(): AgentResult {
  return {
    output: {
      verdict: 'approved',
      confidence: 0.95,
      criteriaChecks: [],
      findings: [],
      decisionSummaries: [],
    },
    decisionSummaries: [],
    events: [],
  };
}

describe('runConvergentReviewWorkflow (M19.04)', () => {
  beforeEach(() => {
    mockRun.mockReset();
    mockReplay.mockReset();
    mockReplay.mockReturnValue([]);
    mockExecSync.mockReset();
    mockExecSync.mockReturnValue('');
    mockAccumulatePersonaStats.mockClear();
    vi.clearAllMocks();
    mockReplay.mockReturnValue([]);
  });

  // Test 1: round 1 A finds 1 CRITICAL, B finds 0; rounds 2+3 have 0 new CRITICAL → converge at round 3
  it('test 1: transitions to factory:approved when 2 consecutive rounds have 0 new CRITICAL findings', async () => {
    const item = makeWorkItem();
    const source = makeMockSource({
      getPrDiff: vi.fn().mockResolvedValue('diff --git a/src/utils.ts b/src/utils.ts\n+added'),
    });

    // Round 1: A finds 1 CRITICAL, B finds 0
    mockRun.mockResolvedValueOnce(makeCriticalResult('Missing input validation')); // R1-A
    mockRun.mockResolvedValueOnce(makeApprovedResultNoFindings()); // R1-B
    // Round 2: both return 0 findings (0 new CRITICAL vs prior round)
    mockRun.mockResolvedValueOnce(makeApprovedResultNoFindings()); // R2-A
    mockRun.mockResolvedValueOnce(makeApprovedResultNoFindings()); // R2-B
    // Round 3: both return 0 findings (0 new CRITICAL → 2 consecutive, converge)
    mockRun.mockResolvedValueOnce(makeApprovedResultNoFindings()); // R3-A
    mockRun.mockResolvedValueOnce(makeApprovedResultNoFindings()); // R3-B

    const { runConvergentReviewWorkflow } = await import('./workflow.js');
    await runConvergentReviewWorkflow(item, source, 'test-project', 'owner/repo');

    expect(source.transitionState).toHaveBeenCalledWith(
      '42',
      'factory:needs-review',
      'factory:approved',
    );
    // Should have run 3 rounds × 2 reviewers = 6 runtime calls
    expect(mockRun).toHaveBeenCalledTimes(6);
  });

  // Test 2: round 3 finds new CRITICAL at cap → escalates, does NOT merge
  it('test 2: escalates to factory:needs-human when cap reached with new CRITICAL findings', async () => {
    const item = makeWorkItem();
    const source = makeMockSource({
      getPrDiff: vi.fn().mockResolvedValue('diff --git a/src/utils.ts b/src/utils.ts\n+added'),
    });

    // Each round introduces a new CRITICAL finding so consecutiveZeroCritical stays 0
    mockRun.mockResolvedValueOnce(makeCriticalResult('Issue A')); // R1-A
    mockRun.mockResolvedValueOnce(makeApprovedResultNoFindings()); // R1-B
    mockRun.mockResolvedValueOnce(makeCriticalResult('Issue B')); // R2-A (new)
    mockRun.mockResolvedValueOnce(makeApprovedResultNoFindings()); // R2-B
    mockRun.mockResolvedValueOnce(makeCriticalResult('Issue C')); // R3-A (new, at cap)
    mockRun.mockResolvedValueOnce(makeApprovedResultNoFindings()); // R3-B

    const { runConvergentReviewWorkflow } = await import('./workflow.js');
    await runConvergentReviewWorkflow(item, source, 'test-project', 'owner/repo');

    expect(source.transitionState).toHaveBeenCalledWith(
      '42',
      'factory:needs-review',
      'factory:needs-human',
    );
    // Verify it does NOT transition to approved
    expect(source.transitionState).not.toHaveBeenCalledWith(
      '42',
      'factory:needs-review',
      'factory:approved',
    );
  });

  // Test 3: auth-tagged PR forces minRounds=3; new CRITICAL at round 3 → escalates
  it('test 3: auth-topic PR escalates when new CRITICAL appears at round 3 despite early zero-critical rounds', async () => {
    const item = makeWorkItem();
    // prDiff contains src/auth.ts → classifyTopic returns minRounds=3
    const source = makeMockSource({
      getPrDiff: vi
        .fn()
        .mockResolvedValue('diff --git a/src/auth.ts b/src/auth.ts\n+added session logic'),
    });

    // Round 1: 0 CRITICAL (consecutiveZero=1)
    mockRun.mockResolvedValueOnce(makeApprovedResultNoFindings()); // R1-A
    mockRun.mockResolvedValueOnce(makeApprovedResultNoFindings()); // R1-B
    // Round 2: 0 new CRITICAL (consecutiveZero=2, but round<minRounds=3 → NOT converged)
    mockRun.mockResolvedValueOnce(makeApprovedResultNoFindings()); // R2-A
    mockRun.mockResolvedValueOnce(makeApprovedResultNoFindings()); // R2-B
    // Round 3: new CRITICAL appears at cap → escalate
    mockRun.mockResolvedValueOnce(makeCriticalResult('Session token not validated')); // R3-A
    mockRun.mockResolvedValueOnce(makeApprovedResultNoFindings()); // R3-B

    const { runConvergentReviewWorkflow } = await import('./workflow.js');
    await runConvergentReviewWorkflow(item, source, 'test-project', 'owner/repo');

    expect(source.transitionState).toHaveBeenCalledWith(
      '42',
      'factory:needs-review',
      'factory:needs-human',
    );
    expect(source.transitionState).not.toHaveBeenCalledWith(
      '42',
      'factory:needs-review',
      'factory:approved',
    );
    // All 3 rounds must have run (minRounds=3 enforced by auth topic)
    expect(mockRun).toHaveBeenCalledTimes(6);
  });

  // Test for P1 fix: needs-human verdict from individual reviewer escalates immediately
  it('escalates immediately when any reviewer returns needs-human verdict', async () => {
    const item = makeWorkItem();
    const source = makeMockSource({
      getPrDiff: vi.fn().mockResolvedValue('diff --git a/src/utils.ts b/src/utils.ts\n+added'),
    });

    // Round 1: reviewer A returns needs-human (no blocker findings needed for this verdict)
    const needsHumanResult: AgentResult = {
      output: {
        verdict: 'needs-human',
        confidence: 0.2,
        criteriaChecks: [],
        findings: [],
        decisionSummaries: [],
        escalationReason: 'Spec is fundamentally ambiguous',
      },
      decisionSummaries: [],
      events: [],
    };
    mockRun.mockResolvedValueOnce(needsHumanResult); // R1-A needs-human
    mockRun.mockResolvedValueOnce(makeApprovedResultNoFindings()); // R1-B approved

    const { runConvergentReviewWorkflow } = await import('./workflow.js');
    const { eventStore } = await import('@goose-hub/core/event-stream/store.js');
    await runConvergentReviewWorkflow(item, source, 'test-project', 'owner/repo');

    // Must escalate to needs-human immediately, not continue to round 2
    expect(source.transitionState).toHaveBeenCalledWith(
      '42',
      'factory:needs-review',
      'factory:needs-human',
    );
    expect(mockRun).toHaveBeenCalledTimes(2); // only round 1 ran

    // Must emit review.completed so UI/downstream consumers see the outcome
    const completedEvents = vi
      .mocked(eventStore.appendEvent)
      .mock.calls.filter(([e]) => e.kind === 'review.completed');
    expect(completedEvents).toHaveLength(1);
    expect(completedEvents[0]?.[0].payload).toMatchObject({ verdict: 'needs-human' });
  });

  // Test for P2 fix: review.completed emitted on convergence path
  it('emits review.completed with verdict approved when converging', async () => {
    const item = makeWorkItem();
    const source = makeMockSource({
      getPrDiff: vi.fn().mockResolvedValue('diff --git a/src/utils.ts b/src/utils.ts\n+added'),
    });

    // 3 rounds × 2 reviewers all returning approved with no findings → converge at round 3
    for (let i = 0; i < 6; i++) mockRun.mockResolvedValueOnce(makeApprovedResultNoFindings());

    const { runConvergentReviewWorkflow } = await import('./workflow.js');
    const { eventStore } = await import('@goose-hub/core/event-stream/store.js');
    await runConvergentReviewWorkflow(item, source, 'test-project', 'owner/repo');

    const completedEvents = vi
      .mocked(eventStore.appendEvent)
      .mock.calls.filter(([e]) => e.kind === 'review.completed');
    expect(completedEvents).toHaveLength(1);
    expect(completedEvents[0]?.[0].payload).toMatchObject({ verdict: 'approved' });
  });

  // Test 4: holdout discipline — sibling decision summary leak is detected via tool.violation
  it('test 4: emits tool.violation when sibling decision summaries are injected into a reviewer context', async () => {
    const { assembleSpawnContext } = await import(
      '@goose-hub/core/agent-runtime/context-assembly.js'
    );
    const { eventStore } = await import('@goose-hub/core/event-stream/store.js');
    vi.mocked(eventStore.appendEvent).mockClear();

    // Simulate a leaky AgentSpec where siblingDecisionSummaries (a disallowed key)
    // is present in the reviewer's context — the assembleSpawnContext holdout
    // enforcement must detect and report it.
    const leakySpec: AgentSpec = {
      runId: 'holdout-test-run',
      role: 'reviewer',
      skill: 'review',
      context: {
        projectId: 'test-project',
        workItemId: 'github:owner/repo#42',
        workItem: { title: 'T', body: 'B', number: 42 },
        prDiff: '',
        qaVerdict: undefined,
        siblingDecisionSummaries: [
          { kind: 'IMPLEMENTATION_PLAN', summary: 'reviewer A decided X' },
        ],
      },
      contextAllowlist: ['workItem', 'prDiff', 'qaVerdict'],
      freshContext: true,
      toolBundles: ['read', 'validate'],
      toolExtras: [],
      budgets: { maxTurns: 25, maxBudgetUsd: 0.5, timeoutMs: 30_000 },
      personaId: 'test-project/reviewer/0',
    };

    assembleSpawnContext(leakySpec);

    const violations = vi
      .mocked(eventStore.appendEvent)
      .mock.calls.filter(([e]) => e.kind === 'tool.violation');
    expect(violations).toHaveLength(1);
    expect(violations[0]?.[0].payload).toMatchObject({
      disallowedKey: 'siblingDecisionSummaries',
      role: 'reviewer',
    });
  });
});
