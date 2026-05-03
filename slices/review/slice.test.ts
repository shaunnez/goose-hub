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
  selectPersona: vi.fn().mockReturnValue('test-project/reviewer/0'),
}));

vi.mock('@goose-hub/core/event-stream/store.js', () => ({
  eventStore: {
    appendEvent: vi
      .fn()
      .mockReturnValue({ id: 1, kind: 'review.completed', payload: {}, createdAt: '' }),
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
      findings: [{ severity: 'blocker', description: 'not implemented' }],
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
    watchForUpdates: vi.fn(),
    ...overrides,
  };
}

// ─── test setup ───────────────────────────────────────────────────────────────

beforeEach(() => {
  mockRun.mockReset();
  vi.clearAllMocks();
});

// ─── tests ────────────────────────────────────────────────────────────────────

describe('runReviewWorkflow', () => {
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
});
