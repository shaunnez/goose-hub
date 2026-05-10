import type { AgentResult } from '@goose-hub/core/agent-runtime/interface.js';
import type { StateSource, WorkItem } from '@goose-hub/core/state-source/interface.js';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

process.env.MOCK_AGENTS = 'true';
afterAll(() => {
  process.env.MOCK_AGENTS = undefined;
});

// ─── module mocks ──────────────────────────────────────────────────────────────

const mockInvokeSkill = vi.fn();
const mockValidateEngineeringSpec = vi.fn();
const mockPersistEngineeringSpec = vi.fn();

vi.mock('@goose-hub/core/agent-runtime/invoke-skill.js', () => ({
  invokeSkill: (...args: unknown[]) => mockInvokeSkill(...args),
}));

vi.mock('@goose-hub/skills/spec-author/validate.js', () => ({
  validateEngineeringSpec: (...args: unknown[]) => mockValidateEngineeringSpec(...args),
}));

vi.mock('@goose-hub/core/engineering-specs/repository.js', () => ({
  persistEngineeringSpec: (...args: unknown[]) => mockPersistEngineeringSpec(...args),
}));

vi.mock('@goose-hub/core/scout-reports/repository.js', () => ({
  listScoutReportsForInvestigation: vi.fn().mockReturnValue([]),
}));

vi.mock('@goose-hub/core/event-stream/store.js', () => ({
  eventStore: {
    appendEvent: vi
      .fn()
      .mockReturnValue({ id: 1, kind: 'spec.completed', payload: {}, createdAt: '' }),
    replay: vi.fn().mockReturnValue([]),
  },
}));

vi.mock('@goose-hub/core/workspaces/worktree.js', () => ({
  createWorktree: vi.fn().mockReturnValue('/tmp/test-spec-worktree'),
  cleanupWorktree: vi.fn(),
}));

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return { ...actual, readFileSync: vi.fn().mockReturnValue('# mock prompt') };
});

// ─── helpers ──────────────────────────────────────────────────────────────────

function makeWorkItem(overrides: Partial<WorkItem> = {}): WorkItem {
  return {
    id: 'github:shaunnez/goose-hub#55',
    externalId: '55',
    repoRef: 'shaunnez/goose-hub',
    title: 'Add spec-author workflow',
    body: 'Implement the spec-author workflow for M19.17.',
    type: 'bug',
    priority: 'high',
    mode: 'supervised',
    state: 'factory:dev-ready',
    authorIsOwner: true,
    schedule: 'current',
    exec: 'serial',
    dependsOn: [],
    blocks: [],
    createdAt: new Date(),
    ...overrides,
  };
}

function makeSpecOutput(overrides: Record<string, unknown> = {}) {
  return {
    objective: 'Wire spec-author workflow.',
    userJourneys: [
      {
        id: 'J1',
        actor: 'developer',
        steps: [{ idx: 0, description: 'Issue enters factory:dev-ready' }],
      },
    ],
    functionalRequirements: [{ id: 'FR1', statement: 'Run spec-author skill on dev-ready.' }],
    architecture: {
      current: 'No spec-author step.',
      new: 'spec-author runs before parallel-implement.',
      decisionRationale: 'Ensures structured spec before parallel build.',
    },
    schemaChanges: { ddl: [], migrations: [] },
    interfaceContracts: [],
    workPackages: [
      {
        id: 'WP1',
        filesOwned: ['slices/spec-author/workflow.ts'],
        changes: 'Create spec-author workflow.',
        dependsOn: [],
        builderTier: 'sonnet',
      },
    ],
    executionOrder: [{ batch: 0, wpIds: ['WP1'] }],
    verificationTooling: [],
    acceptanceCriteria: [
      {
        id: 'AC1',
        statement: 'Spec emitted and persisted.',
        journeyRef: 'J1',
        stepIdx: 0,
        verifyCommand: 'pnpm test',
        source: 'user-journey',
      },
    ],
    constraints: [],
    riskRegister: [],
    decisionSummaries: [{ kind: 'IMPLEMENTATION_PLAN', summary: 'Wire spec-author workflow.' }],
    ...overrides,
  };
}

function makeMockSource(overrides: Partial<StateSource> = {}): StateSource {
  return {
    projectId: 'goose-hub-self',
    repoRef: 'shaunnez/goose-hub',
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
  mockInvokeSkill.mockReset();
  mockValidateEngineeringSpec.mockReset();
  mockPersistEngineeringSpec.mockReset();
  vi.clearAllMocks();

  // Default happy path
  mockInvokeSkill.mockResolvedValue({
    output: makeSpecOutput(),
    decisionSummaries: [],
    events: [],
  } satisfies AgentResult);

  mockValidateEngineeringSpec.mockReturnValue({ ok: true });
});

// ─── tests ────────────────────────────────────────────────────────────────────

describe('runSpecAuthorWorkflow', () => {
  describe('golden path — acceptance criterion 1', () => {
    it('persists the engineering spec on success', async () => {
      const { runSpecAuthorWorkflow } = await import('./workflow.js');
      await runSpecAuthorWorkflow(makeWorkItem(), makeMockSource(), 'goose-hub-self', '/repo');

      expect(mockPersistEngineeringSpec).toHaveBeenCalledWith(
        'goose-hub-self',
        'github:shaunnez/goose-hub#55',
        expect.any(String),
        expect.objectContaining({ objective: expect.any(String) }),
      );
    });

    it('emits spec.completed event with pipelineRunId and workItemId', async () => {
      const { runSpecAuthorWorkflow } = await import('./workflow.js');
      const { eventStore } = await import('@goose-hub/core/event-stream/store.js');
      await runSpecAuthorWorkflow(makeWorkItem(), makeMockSource(), 'goose-hub-self', '/repo');

      const call = vi
        .mocked(eventStore.appendEvent)
        .mock.calls.find(([e]) => e.kind === 'spec.completed');
      expect(call).toBeDefined();
      const payload = call?.[0].payload as { pipelineRunId: string; workItemId: string };
      expect(typeof payload.pipelineRunId).toBe('string');
      expect(payload.pipelineRunId.length).toBeGreaterThan(0);
      expect(payload.workItemId).toBe('github:shaunnez/goose-hub#55');
    });

    it('transitions to factory:spec-ready on success', async () => {
      const source = makeMockSource();
      const { runSpecAuthorWorkflow } = await import('./workflow.js');
      await runSpecAuthorWorkflow(makeWorkItem(), source, 'goose-hub-self', '/repo');

      expect(source.transitionState).toHaveBeenCalledWith(
        '55',
        'factory:dev-ready',
        'factory:spec-ready',
      );
    });

    it('creates worktree and always cleans it up', async () => {
      const { createWorktree, cleanupWorktree } = await import(
        '@goose-hub/core/workspaces/worktree.js'
      );
      const { runSpecAuthorWorkflow } = await import('./workflow.js');
      await runSpecAuthorWorkflow(makeWorkItem(), makeMockSource(), 'goose-hub-self', '/repo');

      expect(createWorktree).toHaveBeenCalledWith('/repo', expect.any(String));
      expect(cleanupWorktree).toHaveBeenCalledOnce();
    });
  });

  describe('validation failure — acceptance criterion 2', () => {
    it('transitions to factory:needs-human when validateEngineeringSpec fails', async () => {
      mockValidateEngineeringSpec.mockReturnValue({
        ok: false,
        errors: [{ rule: 'file-ownership-collision', message: 'Duplicate file owner' }],
      });

      const source = makeMockSource();
      const { runSpecAuthorWorkflow } = await import('./workflow.js');
      await runSpecAuthorWorkflow(makeWorkItem(), source, 'goose-hub-self', '/repo');

      expect(source.transitionState).toHaveBeenCalledWith(
        '55',
        'factory:dev-ready',
        'factory:needs-human',
      );
    });

    it('does not persist spec when validation fails', async () => {
      mockValidateEngineeringSpec.mockReturnValue({
        ok: false,
        errors: [{ rule: 'file-ownership-collision', message: 'Duplicate file owner' }],
      });

      const { runSpecAuthorWorkflow } = await import('./workflow.js');
      await runSpecAuthorWorkflow(makeWorkItem(), makeMockSource(), 'goose-hub-self', '/repo');

      expect(mockPersistEngineeringSpec).not.toHaveBeenCalled();
    });

    it('still cleans up worktree when validation fails', async () => {
      mockValidateEngineeringSpec.mockReturnValue({
        ok: false,
        errors: [{ rule: 'file-ownership-collision', message: 'Duplicate file owner' }],
      });

      const { cleanupWorktree } = await import('@goose-hub/core/workspaces/worktree.js');
      const { runSpecAuthorWorkflow } = await import('./workflow.js');
      await runSpecAuthorWorkflow(makeWorkItem(), makeMockSource(), 'goose-hub-self', '/repo');

      expect(cleanupWorktree).toHaveBeenCalledOnce();
    });
  });

  describe('missing scout reports fallback — acceptance criterion 3', () => {
    it('calls invokeSkill even when no scout reports are available', async () => {
      const { eventStore } = await import('@goose-hub/core/event-stream/store.js');
      vi.mocked(eventStore.replay).mockReturnValue([]);

      const { runSpecAuthorWorkflow } = await import('./workflow.js');
      await runSpecAuthorWorkflow(makeWorkItem(), makeMockSource(), 'goose-hub-self', '/repo');

      expect(mockInvokeSkill).toHaveBeenCalledWith(
        expect.objectContaining({ skillName: 'spec-author' }),
      );
    });

    it('transitions to spec-ready even with no prior investigation', async () => {
      const { eventStore } = await import('@goose-hub/core/event-stream/store.js');
      vi.mocked(eventStore.replay).mockReturnValue([]);

      const source = makeMockSource();
      const { runSpecAuthorWorkflow } = await import('./workflow.js');
      await runSpecAuthorWorkflow(makeWorkItem(), source, 'goose-hub-self', '/repo');

      expect(source.transitionState).toHaveBeenCalledWith(
        '55',
        'factory:dev-ready',
        'factory:spec-ready',
      );
    });
  });

  describe('spec survives worktree cleanup — acceptance criterion 4', () => {
    it('persists spec before cleanupWorktree is called', async () => {
      const callOrder: string[] = [];
      mockPersistEngineeringSpec.mockImplementation(() => {
        callOrder.push('persist');
      });

      const { cleanupWorktree } = await import('@goose-hub/core/workspaces/worktree.js');
      vi.mocked(cleanupWorktree).mockImplementation(() => {
        callOrder.push('cleanup');
      });

      const { runSpecAuthorWorkflow } = await import('./workflow.js');
      await runSpecAuthorWorkflow(makeWorkItem(), makeMockSource(), 'goose-hub-self', '/repo');

      expect(callOrder.indexOf('persist')).toBeLessThan(callOrder.indexOf('cleanup'));
    });
  });

  describe('unexpected error path', () => {
    it('escalates to factory:needs-human when invokeSkill throws', async () => {
      mockInvokeSkill.mockRejectedValueOnce(new Error('Agent timeout'));

      const source = makeMockSource();
      const { runSpecAuthorWorkflow } = await import('./workflow.js');
      await runSpecAuthorWorkflow(makeWorkItem(), source, 'goose-hub-self', '/repo');

      expect(source.transitionState).toHaveBeenCalledWith(
        '55',
        'factory:dev-ready',
        'factory:needs-human',
      );
    });

    it('still cleans up worktree after unexpected error', async () => {
      mockInvokeSkill.mockRejectedValueOnce(new Error('Agent timeout'));

      const { cleanupWorktree } = await import('@goose-hub/core/workspaces/worktree.js');
      const { runSpecAuthorWorkflow } = await import('./workflow.js');
      await runSpecAuthorWorkflow(makeWorkItem(), makeMockSource(), 'goose-hub-self', '/repo');

      expect(cleanupWorktree).toHaveBeenCalledOnce();
    });
  });

  describe('label installer — acceptance criterion 6', () => {
    it('FACTORY_LABELS includes factory:spec-ready with correct color', async () => {
      const { FACTORY_LABELS } = await import('@goose-hub/core/bootstrap/labels.js');
      const label = FACTORY_LABELS.find((l) => l.name === 'factory:spec-ready');
      expect(label).toBeDefined();
      expect(label?.color).toBe('1d76db');
    });
  });
});
