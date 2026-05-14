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

describe('EngineeringSpecSchema constraint source format', () => {
  it('accepts single-line and symbol constraint citations', async () => {
    const { EngineeringSpecSchema } = await import('@goose-hub/skills/spec-author/schema.js');

    const result = EngineeringSpecSchema.safeParse(
      makeSpecOutput({
        constraints: [
          { kind: 'model', name: 'EventLike interface', source: 'core/event-types.ts:EventLike' },
          { kind: 'output-format', name: 'server README shape', source: 'apps/server/README.md:5' },
        ],
      }),
    );

    expect(result.success).toBe(true);
  });

  it('rejects SYMBOL prefixes and line ranges at schema validation', async () => {
    const { EngineeringSpecSchema } = await import('@goose-hub/skills/spec-author/schema.js');

    const symbolPrefix = EngineeringSpecSchema.safeParse(
      makeSpecOutput({
        constraints: [
          {
            kind: 'model',
            name: 'EventLike interface',
            source: 'core/agent-runtime/event-types.ts:SYMBOL:EventLike',
          },
        ],
      }),
    );
    const lineRange = EngineeringSpecSchema.safeParse(
      makeSpecOutput({
        constraints: [
          {
            kind: 'output-format',
            name: 'README response shape',
            source: 'apps/server/README.md:5-20',
          },
        ],
      }),
    );

    expect(symbolPrefix.success).toBe(false);
    expect(lineRange.success).toBe(false);
  });
});

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

    it('normalizes null optional leaf fields before validation and persistence', async () => {
      mockInvokeSkill.mockResolvedValueOnce({
        output: makeSpecOutput({
          interfaceContracts: [
            {
              name: 'SpecContract',
              signature: 'export type SpecContract = { ok: true };',
              file: 'core/spec.ts',
              lineRange: null,
            },
          ],
          verificationTooling: [
            {
              name: 'spec-check',
              scriptPath: 'scripts/spec-check.ts',
              expectedExitCodes: [0],
              inputSpec: null,
            },
          ],
          acceptanceCriteria: [
            {
              id: 'AC1',
              statement: 'Spec emitted and persisted.',
              journeyRef: null,
              stepIdx: null,
              verifyCommand: 'pnpm test',
              tolerance: null,
              crossCutting: null,
              source: null,
            },
          ],
        }),
        decisionSummaries: [],
        events: [],
      } satisfies AgentResult);

      const { runSpecAuthorWorkflow } = await import('./workflow.js');
      await runSpecAuthorWorkflow(makeWorkItem(), makeMockSource(), 'goose-hub-self', '/repo');

      const validatedSpec = mockValidateEngineeringSpec.mock.calls[0]?.[0] as Record<
        string,
        unknown
      >;
      const persistedSpec = mockPersistEngineeringSpec.mock.calls[0]?.[3] as Record<
        string,
        unknown
      >;

      expect(validatedSpec).toEqual(persistedSpec);
      expect(persistedSpec).toMatchObject({
        interfaceContracts: [
          expect.not.objectContaining({
            lineRange: expect.anything(),
          }),
        ],
        verificationTooling: [
          expect.not.objectContaining({
            inputSpec: expect.anything(),
          }),
        ],
        acceptanceCriteria: [
          expect.not.objectContaining({
            journeyRef: expect.anything(),
            stepIdx: expect.anything(),
            tolerance: expect.anything(),
            crossCutting: expect.anything(),
            source: expect.anything(),
          }),
        ],
      });
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
    it('retries once with repair feedback when structural validation fails, then persists repaired spec', async () => {
      mockValidateEngineeringSpec
        .mockReturnValueOnce({
          ok: false,
          errors: [
            {
              rule: 'constraint-source-format',
              message:
                "constraint 'EventLike interface' source 'core/agent-runtime/event-types.ts:SYMBOL:EventLike' is not 'path:line' or 'path:symbol' format",
            },
          ],
        })
        .mockReturnValueOnce({ ok: true });

      const source = makeMockSource();
      const { runSpecAuthorWorkflow } = await import('./workflow.js');
      await runSpecAuthorWorkflow(makeWorkItem(), source, 'goose-hub-self', '/repo');

      expect(mockInvokeSkill).toHaveBeenCalledTimes(2);
      const retryInput = mockInvokeSkill.mock.calls[1]?.[0] as {
        overrides?: {
          appendContext?: { repairFeedback?: string };
          extraEventPayload?: Record<string, unknown>;
          workspaceDir?: string;
        };
      };
      expect(retryInput.overrides?.appendContext?.repairFeedback).toContain(
        'core/agent-runtime/event-types.ts:SYMBOL:EventLike',
      );
      expect(retryInput.overrides?.extraEventPayload).toMatchObject({
        attempt: 'repair',
        repairOf: expect.any(String),
      });
      expect(retryInput.overrides?.workspaceDir).toBe('/tmp/test-spec-worktree');
      expect(mockPersistEngineeringSpec).toHaveBeenCalledOnce();
      expect(source.transitionState).toHaveBeenCalledWith(
        '55',
        'factory:dev-ready',
        'factory:spec-ready',
      );
    });

    it('retries once with repair feedback when output schema validation fails', async () => {
      const outputError = Object.assign(
        new Error("invokeSkill: output validation failed for 'spec-author'"),
        {
          name: 'OutputValidationError',
          runTelemetry: { runId: 'first-run-id', skill: 'spec-author' },
          issues: [
            {
              path: ['constraints', 0, 'source'],
              message:
                'Use exactly path/to/file.ts:123 or path/to/file.ts:SymbolName; do not use line ranges or SYMBOL: prefixes',
            },
          ],
        },
      );
      mockInvokeSkill.mockRejectedValueOnce(outputError).mockResolvedValueOnce({
        output: makeSpecOutput(),
        decisionSummaries: [],
        events: [],
      } satisfies AgentResult);

      const source = makeMockSource();
      const { runSpecAuthorWorkflow } = await import('./workflow.js');
      await runSpecAuthorWorkflow(makeWorkItem(), source, 'goose-hub-self', '/repo');

      expect(mockInvokeSkill).toHaveBeenCalledTimes(2);
      const retryInput = mockInvokeSkill.mock.calls[1]?.[0] as {
        overrides?: {
          appendContext?: { repairFeedback?: string };
          extraEventPayload?: Record<string, unknown>;
        };
      };
      expect(retryInput.overrides?.appendContext?.repairFeedback).toContain('constraints.0.source');
      expect(retryInput.overrides?.extraEventPayload).toMatchObject({
        attempt: 'repair',
        repairOf: 'first-run-id',
      });
      expect(mockPersistEngineeringSpec).toHaveBeenCalledOnce();
      expect(source.transitionState).toHaveBeenCalledWith(
        '55',
        'factory:dev-ready',
        'factory:spec-ready',
      );
    });

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

    it('emits a state.transitioned event after moving to spec-ready', async () => {
      const { eventStore } = await import('@goose-hub/core/event-stream/store.js');
      const source = makeMockSource();
      const { runSpecAuthorWorkflow } = await import('./workflow.js');
      await runSpecAuthorWorkflow(makeWorkItem(), source, 'goose-hub-self', '/repo');

      const transitionCall = vi
        .mocked(eventStore.appendEvent)
        .mock.calls.find(([e]) => e.kind === 'state.transitioned');
      expect(transitionCall?.[0]).toMatchObject({
        projectId: 'goose-hub-self',
        workItemId: 'github:shaunnez/goose-hub#55',
        payload: {
          from: 'factory:dev-ready',
          to: 'factory:spec-ready',
          by: 'spec-author',
        },
      });
    });

    it('passes scout report summaries and refs to spec-author without rehydrating full blobs', async () => {
      const { eventStore } = await import('@goose-hub/core/event-stream/store.js');
      const scoutRepo = await import('@goose-hub/core/scout-reports/repository.js');
      vi.mocked(eventStore.replay).mockReturnValue([
        {
          id: 1,
          projectId: 'goose-hub-self',
          workItemId: 'github:shaunnez/goose-hub#55',
          kind: 'agent.investigation-complete',
          payload: { investigationRunId: 'investigation-run' },
          runId: 'investigation-run',
          createdAt: '2026-05-14T00:00:00Z',
        },
      ] as never);
      vi.mocked(scoutRepo.listScoutReportsForInvestigation).mockReturnValue([
        {
          id: 1,
          projectId: 'goose-hub-self',
          workItemId: 'github:shaunnez/goose-hub#55',
          investigationRunId: 'investigation-run',
          scoutSkill: 'scout-code-path',
          report: {
            summary: 'scout-code-path: 1 findings, 1 decision summaries',
            findingCount: 1,
            decisionSummaryCount: 1,
            artifactRef: {
              artifactKey: 'scout-report:abc',
              kind: 'scout-report',
              summary: 'scout-code-path: 1 findings, 1 decision summaries',
              bytes: 40_000,
              stored: true,
            },
          },
          createdAt: '2026-05-14T00:00:00Z',
        },
      ]);

      const { runSpecAuthorWorkflow } = await import('./workflow.js');
      await runSpecAuthorWorkflow(makeWorkItem(), makeMockSource(), 'goose-hub-self', '/repo');

      const invokeOpts = mockInvokeSkill.mock.calls[0][0] as {
        context: { scoutReports?: string };
      };
      expect(invokeOpts.context.scoutReports).toContain('scout-report:abc');
      expect(invokeOpts.context.scoutReports).toContain(
        'scout-code-path: 1 findings, 1 decision summaries',
      );
      expect(invokeOpts.context.scoutReports).not.toContain('large full finding body');
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

    it('surfaces output validation issue paths in the event and comment', async () => {
      const outputError = Object.assign(
        new Error("invokeSkill: output validation failed for 'spec-author'"),
        {
          name: 'OutputValidationError',
          runTelemetry: { runId: 'terminal-run-id', skill: 'spec-author' },
          issues: [
            {
              path: ['decisionSummaries', 0, 'kind'],
              message: 'Invalid enum value',
            },
          ],
        },
      );
      mockInvokeSkill.mockRejectedValueOnce(outputError).mockRejectedValueOnce(outputError);

      const source = makeMockSource();
      const { eventStore } = await import('@goose-hub/core/event-stream/store.js');
      const { runSpecAuthorWorkflow } = await import('./workflow.js');
      await runSpecAuthorWorkflow(makeWorkItem(), source, 'goose-hub-self', '/repo');

      const failureCall = vi
        .mocked(eventStore.appendEvent)
        .mock.calls.find(([e]) => e.kind === 'agent.run-failed');
      expect(failureCall?.[0].payload).toMatchObject({
        skill: 'spec-author',
        issues: ['decisionSummaries.0.kind: Invalid enum value'],
      });
      expect(source.comment).toHaveBeenCalledWith(
        '55',
        expect.stringContaining('Schema issue: decisionSummaries.0.kind: Invalid enum value'),
      );

      const transitionCall = vi
        .mocked(eventStore.appendEvent)
        .mock.calls.find(([e]) => e.kind === 'state.transitioned');
      expect(transitionCall?.[0].payload).toMatchObject({
        from: 'factory:dev-ready',
        to: 'factory:needs-human',
        by: 'spec-author',
      });
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
