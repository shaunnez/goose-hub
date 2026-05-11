import type { AgentResult, AgentRuntime } from '@goose-hub/core/agent-runtime/interface.js';
import type { ScoutReport, WaveResult } from '@goose-hub/core/agent-runtime/swarm.js';
import type { StateSource, WorkItem } from '@goose-hub/core/state-source/interface.js';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Skip playwright-test MCP pre-flight subprocess in workflow.ts
process.env.MOCK_AGENTS = 'true';
afterAll(() => {
  process.env.MOCK_AGENTS = undefined;
});

// ─── module mocks ──────────────────────────────────────────────────────────────

const mockDispatchWave = vi.fn();
const mockCrossValidate = vi.fn();
const mockInvokeSkill = vi.fn();
const mockPersistScoutReport = vi.fn();
const mockLookupWorkItemSymbols = vi.fn();

vi.mock('@goose-hub/core/agent-runtime/swarm.js', () => ({
  dispatchWave: (...args: unknown[]) => mockDispatchWave(...args),
}));

vi.mock('@goose-hub/core/symbol-index/lookup.js', () => ({
  lookupWorkItemSymbols: (...args: unknown[]) => mockLookupWorkItemSymbols(...args),
}));

vi.mock('@goose-hub/core/agent-runtime/cross-validate.js', () => ({
  crossValidate: (...args: unknown[]) => mockCrossValidate(...args),
}));

vi.mock('@goose-hub/core/agent-runtime/invoke-skill.js', () => ({
  invokeSkill: (...args: unknown[]) => mockInvokeSkill(...args),
}));

vi.mock('@goose-hub/core/scout-reports/repository.js', () => ({
  persistScoutReport: (...args: unknown[]) => mockPersistScoutReport(...args),
}));

// Single shared mock for ClaudeCliRuntime (playwright-repro step)
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
    .mockReturnValue({ personaId: 'test-project/investigator/0', codename: 'Grey Honker' }),
}));

vi.mock('@goose-hub/core/event-stream/store.js', () => ({
  eventStore: {
    appendEvent: vi
      .fn()
      .mockReturnValue({ id: 1, kind: 'agent.investigation-complete', payload: {}, createdAt: '' }),
  },
}));

vi.mock('@goose-hub/core/workspaces/worktree.js', () => ({
  createWorktree: vi.fn().mockReturnValue('/tmp/test-worktree'),
  cleanupWorktree: vi.fn(),
  prewarmWorktree: vi.fn(),
}));

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return { ...actual, readFileSync: vi.fn().mockReturnValue('# mock prompt') };
});

// ─── helpers ──────────────────────────────────────────────────────────────────

function makeWorkItem(overrides: Partial<WorkItem> = {}): WorkItem {
  return {
    id: 'github:shaunnez/goose-hub#42',
    externalId: '42',
    repoRef: 'shaunnez/goose-hub',
    title: 'Fix auth bug',
    body: 'Auth breaks on login.\n\nRepro steps:\n1. Go to /login\n2. Enter credentials\n3. Observe 500 error',
    type: 'bug',
    priority: 'high',
    mode: 'supervised',
    state: 'factory:investigating',
    authorIsOwner: true,
    schedule: 'current',
    exec: 'serial',
    dependsOn: [],
    blocks: [],
    createdAt: new Date(),
    ...overrides,
  };
}

function makeInvestigateOutput(overrides: Record<string, unknown> = {}) {
  return {
    findings: 'Root cause is a null-check missing in auth middleware.',
    keyFiles: [{ path: 'apps/server/src/middleware/auth.ts', reason: 'Contains null-dereference' }],
    confidence: 'high',
    openQuestions: ['Does this also affect WebSocket upgrade path?'],
    requiresBrowserRepro: false,
    decisionSummaries: [
      {
        kind: 'READ',
        summary: 'Read issue #42: auth middleware crashes on missing session token',
      },
    ],
    ...overrides,
  };
}

function makePlaywrightReproOutput() {
  return {
    screenshots: [
      { path: 'evidence/issue-42/step-1.png', caption: 'Login error visible', step: 3 },
    ],
    gifPath: null,
    consoleErrors: [
      { message: 'TypeError: Cannot read property of undefined', type: 'error' as const },
    ],
    reproSteps: ['Navigate to /login', 'Enter credentials', 'Click submit'],
    reproduced: true,
    notes: 'Bug reproduced consistently.',
  };
}

function makeScoutReport(scoutName: string, overrides: Partial<ScoutReport> = {}): ScoutReport {
  return {
    scoutName,
    status: 'ok',
    findings: [{ file: 'src/app.ts', fact: 'Module entry point', confidence: 'high' }],
    decisionSummaries: [],
    runId: `run:scout:${scoutName}:0`,
    ...overrides,
  };
}

function makeWaveResult(overrides: Partial<WaveResult> = {}): WaveResult {
  return {
    status: 'ok',
    reports: [
      makeScoutReport('scout-code-path'),
      makeScoutReport('scout-dependency'),
      makeScoutReport('scout-pattern'),
    ],
    failedScouts: [],
    shouldAdvance: true,
    shouldEscalate: false,
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
  mockDispatchWave.mockReset();
  mockCrossValidate.mockReset();
  mockInvokeSkill.mockReset();
  mockPersistScoutReport.mockReset();
  mockRun.mockReset();
  vi.clearAllMocks();
  mockAccumulatePersonaStats.mockClear();
  mockLookupWorkItemSymbols.mockReturnValue([]);

  // Default happy path
  mockDispatchWave.mockResolvedValue(makeWaveResult());
  mockCrossValidate.mockReturnValue({ contradictions: [], hasContradictions: false });
  mockInvokeSkill.mockResolvedValue({
    output: makeInvestigateOutput(),
    decisionSummaries: [],
    events: [],
  } satisfies AgentResult);
});

// ─── tests ────────────────────────────────────────────────────────────────────

describe('runInvestigateWorkflow', () => {
  describe('swarm dispatch — acceptance criterion 1', () => {
    it('calls dispatchWave exactly twice (Wave 1 then Wave 2)', async () => {
      const { runInvestigateWorkflow } = await import('./workflow.js');
      await runInvestigateWorkflow(makeWorkItem(), makeMockSource(), 'goose-hub-self', '/repo');

      expect(mockDispatchWave).toHaveBeenCalledTimes(2);
    });

    it('calls crossValidate exactly once with Wave 1 reports', async () => {
      const wave1 = makeWaveResult();
      mockDispatchWave.mockResolvedValueOnce(wave1).mockResolvedValueOnce(makeWaveResult());

      const { runInvestigateWorkflow } = await import('./workflow.js');
      await runInvestigateWorkflow(makeWorkItem(), makeMockSource(), 'goose-hub-self', '/repo');

      expect(mockCrossValidate).toHaveBeenCalledTimes(1);
      expect(mockCrossValidate).toHaveBeenCalledWith(wave1.reports);
    });

    it('Wave 2 scouts receive scoutReports in extraContext', async () => {
      const { runInvestigateWorkflow } = await import('./workflow.js');
      await runInvestigateWorkflow(makeWorkItem(), makeMockSource(), 'goose-hub-self', '/repo');

      const wave2Opts = mockDispatchWave.mock.calls[1][0] as {
        scoutSpecs: Array<{ extraContext?: Record<string, unknown> }>;
      };
      for (const spec of wave2Opts.scoutSpecs) {
        expect(spec.extraContext).toHaveProperty('scoutReports');
        expect(typeof spec.extraContext?.scoutReports).toBe('string');
      }
    });

    it('creates worktree and always cleans it up', async () => {
      const { createWorktree, cleanupWorktree } = await import(
        '@goose-hub/core/workspaces/worktree.js'
      );
      const { runInvestigateWorkflow } = await import('./workflow.js');
      await runInvestigateWorkflow(makeWorkItem(), makeMockSource(), 'goose-hub-self', '/repo');

      expect(createWorktree).toHaveBeenCalledWith('/repo', expect.any(String));
      expect(cleanupWorktree).toHaveBeenCalledOnce();
    });
  });

  describe('scout report persistence — acceptance criterion 2', () => {
    it('persists ok-status Wave 1 scouts to DB', async () => {
      const wave1 = makeWaveResult({
        reports: [
          makeScoutReport('scout-code-path'),
          makeScoutReport('scout-dependency', { status: 'timeout', findings: [], runId: 'x' }),
        ],
        failedScouts: ['scout-dependency'],
      });
      // Wave 2 uses different names to avoid assertion collision with wave1 scout names
      const wave2 = makeWaveResult({
        reports: [
          makeScoutReport('wave2-interface-designer'),
          makeScoutReport('wave2-risk-analyst'),
        ],
      });
      mockDispatchWave.mockResolvedValueOnce(wave1).mockResolvedValueOnce(wave2);

      const { runInvestigateWorkflow } = await import('./workflow.js');
      await runInvestigateWorkflow(makeWorkItem(), makeMockSource(), 'goose-hub-self', '/repo');

      expect(mockPersistScoutReport).toHaveBeenCalledWith(
        'goose-hub-self',
        'github:shaunnez/goose-hub#42',
        expect.any(String),
        'scout-code-path',
        expect.anything(),
      );
      expect(mockPersistScoutReport).not.toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.anything(),
        'scout-dependency',
        expect.anything(),
      );
    });

    it('persists ok-status Wave 2 scouts to DB', async () => {
      const wave2 = makeWaveResult({
        reports: [
          makeScoutReport('wave2-interface-designer'),
          makeScoutReport('wave2-risk-analyst', {
            status: 'error',
            findings: [],
            runId: 'e',
            errorReason: 'oops',
          }),
        ],
        failedScouts: ['wave2-risk-analyst'],
      });
      mockDispatchWave.mockResolvedValueOnce(makeWaveResult()).mockResolvedValueOnce(wave2);

      const { runInvestigateWorkflow } = await import('./workflow.js');
      await runInvestigateWorkflow(makeWorkItem(), makeMockSource(), 'goose-hub-self', '/repo');

      expect(mockPersistScoutReport).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.anything(),
        'wave2-interface-designer',
        expect.anything(),
      );
      expect(mockPersistScoutReport).not.toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.anything(),
        'wave2-risk-analyst',
        expect.anything(),
      );
    });
  });

  describe('cross-validate surfaces contradiction — acceptance criterion 3', () => {
    it('passes contradiction data to synthesis via scoutReports context', async () => {
      const contradiction = {
        file: 'src/auth.ts',
        line: 42,
        facts: [
          { scoutName: 'scout-code-path', fact: 'Token check exists', confidence: 'high' as const },
          { scoutName: 'scout-pattern', fact: 'Token check missing', confidence: 'high' as const },
        ],
        scouts: ['scout-code-path', 'scout-pattern'],
      };
      mockCrossValidate.mockReturnValue({
        contradictions: [contradiction],
        hasContradictions: true,
      });

      const { runInvestigateWorkflow } = await import('./workflow.js');
      await runInvestigateWorkflow(makeWorkItem(), makeMockSource(), 'goose-hub-self', '/repo');

      const invokeOpts = mockInvokeSkill.mock.calls[0][0] as {
        context: { scoutReports: string };
      };
      const scoutReports = JSON.parse(invokeOpts.context.scoutReports) as {
        contradictions: unknown[];
      };
      expect(scoutReports.contradictions).toHaveLength(1);
    });
  });

  describe('scout timeout → workflow continues — acceptance criterion 4', () => {
    it('advances to Wave 2 when one scout times out but shouldAdvance is true', async () => {
      const wave1 = makeWaveResult({
        status: 'ok',
        shouldAdvance: true,
        shouldEscalate: false,
        reports: [
          makeScoutReport('scout-code-path'),
          makeScoutReport('scout-dependency'),
          makeScoutReport('scout-pattern'),
          makeScoutReport('scout-schema', { status: 'timeout', findings: [], runId: 't' }),
        ],
        failedScouts: ['scout-schema'],
      });
      mockDispatchWave.mockResolvedValueOnce(wave1).mockResolvedValueOnce(makeWaveResult());

      const source = makeMockSource();
      const { runInvestigateWorkflow } = await import('./workflow.js');
      await runInvestigateWorkflow(makeWorkItem(), source, 'goose-hub-self', '/repo');

      expect(mockDispatchWave).toHaveBeenCalledTimes(2);
      expect(source.transitionState).toHaveBeenCalledWith(
        '42',
        'factory:investigating',
        'factory:investigation-complete',
      );
    });

    it('does not persist timed-out scout reports', async () => {
      const wave1 = makeWaveResult({
        reports: [
          makeScoutReport('scout-code-path'),
          makeScoutReport('scout-schema', { status: 'timeout', findings: [], runId: 't' }),
        ],
        failedScouts: ['scout-schema'],
      });
      mockDispatchWave.mockResolvedValueOnce(wave1).mockResolvedValueOnce(makeWaveResult());

      const { runInvestigateWorkflow } = await import('./workflow.js');
      await runInvestigateWorkflow(makeWorkItem(), makeMockSource(), 'goose-hub-self', '/repo');

      expect(mockPersistScoutReport).not.toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.anything(),
        'scout-schema',
        expect.anything(),
      );
    });
  });

  describe('2 scout failures → escalate — acceptance criterion 5', () => {
    it('transitions to factory:needs-human when wave1 shouldEscalate', async () => {
      mockDispatchWave.mockResolvedValueOnce(
        makeWaveResult({
          status: 'halted',
          shouldAdvance: false,
          shouldEscalate: true,
          failedScouts: ['scout-code-path', 'scout-dependency'],
        }),
      );

      const source = makeMockSource();
      const { runInvestigateWorkflow } = await import('./workflow.js');
      await runInvestigateWorkflow(makeWorkItem(), source, 'goose-hub-self', '/repo');

      expect(source.transitionState).toHaveBeenCalledWith(
        '42',
        'factory:investigating',
        'factory:needs-human',
      );
    });

    it('does not dispatch Wave 2 when escalating', async () => {
      mockDispatchWave.mockResolvedValueOnce(
        makeWaveResult({ status: 'halted', shouldAdvance: false, shouldEscalate: true }),
      );

      const { runInvestigateWorkflow } = await import('./workflow.js');
      await runInvestigateWorkflow(makeWorkItem(), makeMockSource(), 'goose-hub-self', '/repo');

      expect(mockDispatchWave).toHaveBeenCalledTimes(1);
    });

    it('posts a GitHub comment when escalating', async () => {
      mockDispatchWave.mockResolvedValueOnce(
        makeWaveResult({ status: 'halted', shouldAdvance: false, shouldEscalate: true }),
      );

      const source = makeMockSource();
      const { runInvestigateWorkflow } = await import('./workflow.js');
      await runInvestigateWorkflow(makeWorkItem(), source, 'goose-hub-self', '/repo');

      expect(source.comment).toHaveBeenCalled();
    });

    it('still cleans up worktree when escalating', async () => {
      mockDispatchWave.mockResolvedValueOnce(
        makeWaveResult({ status: 'halted', shouldAdvance: false, shouldEscalate: true }),
      );

      const { cleanupWorktree } = await import('@goose-hub/core/workspaces/worktree.js');
      const { runInvestigateWorkflow } = await import('./workflow.js');
      await runInvestigateWorkflow(makeWorkItem(), makeMockSource(), 'goose-hub-self', '/repo');

      expect(cleanupWorktree).toHaveBeenCalledOnce();
    });
  });

  describe('holdout-key enforcement — acceptance criterion 6', () => {
    it('Wave 2 scoutSpecs contain only scoutReports in extraContext (no disallowed keys)', async () => {
      const { runInvestigateWorkflow } = await import('./workflow.js');
      await runInvestigateWorkflow(makeWorkItem(), makeMockSource(), 'goose-hub-self', '/repo');

      const wave2Opts = mockDispatchWave.mock.calls[1][0] as {
        scoutSpecs: Array<{ extraContext?: Record<string, unknown> }>;
      };
      for (const spec of wave2Opts.scoutSpecs) {
        const extraKeys = Object.keys(spec.extraContext ?? {});
        expect(extraKeys).not.toContain('investigationFindings');
        expect(extraKeys).not.toContain('devDecisionSummaries');
        expect(extraKeys).toEqual(['scoutReports']);
      }
    });

    it('dispatchWave fires tool.violation for disallowed key in extraContext', async () => {
      const fakeRuntime = {
        run: vi.fn().mockResolvedValue({
          output: { findings: [], decisionSummaries: [], confidence: 'medium', openQuestions: [] },
          decisionSummaries: [],
          events: [],
        }),
      };

      const violations: Array<{ disallowedKey: string }> = [];
      const fakeAppend = vi
        .fn()
        .mockImplementation((input: { kind: string; payload: { disallowedKey: string } }) => {
          if (input.kind === 'tool.violation') violations.push(input.payload);
          return { id: 1, kind: input.kind, payload: input.payload, createdAt: '' };
        });

      const { dispatchWave: realDispatchWave } = await vi.importActual<
        typeof import('@goose-hub/core/agent-runtime/swarm.js')
      >('@goose-hub/core/agent-runtime/swarm.js');

      await realDispatchWave({
        parentRunId: 'holdout-test-run',
        scoutSpecs: [
          {
            scoutName: 'scout-code-path',
            scoutFocus: 'test holdout enforcement',
            extraContext: { investigationFindings: 'should not be here' },
          },
        ],
        workItem: { number: 42, title: 'Test', body: 'Test body' },
        worktreePath: '/tmp/test-tree',
        projectId: 'test-project',
        workItemId: 'github:test/repo#42',
        runtime: fakeRuntime as unknown as AgentRuntime,
        personaId: 'test-project/investigator/0',
        appendEvent: fakeAppend,
      });

      expect(violations).toHaveLength(1);
      expect(violations[0].disallowedKey).toBe('investigationFindings');
    });
  });

  describe('investigation-complete event', () => {
    it('includes investigationRunId in payload', async () => {
      const { runInvestigateWorkflow } = await import('./workflow.js');
      const { eventStore } = await import('@goose-hub/core/event-stream/store.js');
      await runInvestigateWorkflow(makeWorkItem(), makeMockSource(), 'goose-hub-self', '/repo');

      const call = vi
        .mocked(eventStore.appendEvent)
        .mock.calls.find(([e]) => e.kind === 'agent.investigation-complete');
      expect(call).toBeDefined();
      const payload = call?.[0].payload as { investigationRunId: string };
      expect(typeof payload.investigationRunId).toBe('string');
      expect(payload.investigationRunId.length).toBeGreaterThan(0);
    });

    it('includes investigate findings in payload', async () => {
      const { runInvestigateWorkflow } = await import('./workflow.js');
      const { eventStore } = await import('@goose-hub/core/event-stream/store.js');
      await runInvestigateWorkflow(makeWorkItem(), makeMockSource(), 'goose-hub-self', '/repo');

      const call = vi
        .mocked(eventStore.appendEvent)
        .mock.calls.find(([e]) => e.kind === 'agent.investigation-complete');
      const payload = call?.[0].payload as { investigate: unknown };
      expect(payload.investigate).toBeDefined();
    });

    it('transitions to factory:investigation-complete on success', async () => {
      const source = makeMockSource();
      const { runInvestigateWorkflow } = await import('./workflow.js');
      await runInvestigateWorkflow(makeWorkItem(), source, 'goose-hub-self', '/repo');

      expect(source.transitionState).toHaveBeenCalledWith(
        '42',
        'factory:investigating',
        'factory:investigation-complete',
      );
    });

    it('records persona success stat', async () => {
      const { runInvestigateWorkflow } = await import('./workflow.js');
      await runInvestigateWorkflow(makeWorkItem(), makeMockSource(), 'goose-hub-self', '/repo');

      expect(mockAccumulatePersonaStats).toHaveBeenCalledWith(
        expect.objectContaining({ outcome: 'success' }),
      );
    });
  });

  describe('type:bug — playwright-repro still runs', () => {
    it('runs playwright-repro for type:bug when requiresBrowserRepro is true', async () => {
      mockInvokeSkill.mockResolvedValueOnce({
        output: makeInvestigateOutput({ requiresBrowserRepro: true }),
        decisionSummaries: [],
        events: [],
      } satisfies AgentResult);
      mockRun.mockResolvedValueOnce({
        output: makePlaywrightReproOutput(),
        decisionSummaries: [],
        events: [],
      } satisfies AgentResult);

      const { runInvestigateWorkflow } = await import('./workflow.js');
      await runInvestigateWorkflow(
        makeWorkItem({ type: 'bug' }),
        makeMockSource(),
        'goose-hub-self',
        '/repo',
      );

      expect(mockRun).toHaveBeenCalledWith(expect.objectContaining({ skill: 'playwright-repro' }));
    });

    it('skips playwright-repro when requiresBrowserRepro is false', async () => {
      mockInvokeSkill.mockResolvedValueOnce({
        output: makeInvestigateOutput({ requiresBrowserRepro: false }),
        decisionSummaries: [],
        events: [],
      } satisfies AgentResult);

      const { runInvestigateWorkflow } = await import('./workflow.js');
      await runInvestigateWorkflow(
        makeWorkItem({ type: 'bug' }),
        makeMockSource(),
        'goose-hub-self',
        '/repo',
      );

      expect(mockRun).not.toHaveBeenCalled();
    });

    it('persists playwrightRepro in investigation-complete event', async () => {
      mockInvokeSkill.mockResolvedValueOnce({
        output: makeInvestigateOutput({ requiresBrowserRepro: true }),
        decisionSummaries: [],
        events: [],
      } satisfies AgentResult);
      mockRun.mockResolvedValueOnce({
        output: makePlaywrightReproOutput(),
        decisionSummaries: [],
        events: [],
      } satisfies AgentResult);

      const { runInvestigateWorkflow } = await import('./workflow.js');
      const { eventStore } = await import('@goose-hub/core/event-stream/store.js');
      await runInvestigateWorkflow(
        makeWorkItem({ type: 'bug' }),
        makeMockSource(),
        'goose-hub-self',
        '/repo',
      );

      const call = vi
        .mocked(eventStore.appendEvent)
        .mock.calls.find(([e]) => e.kind === 'agent.investigation-complete');
      const payload = call?.[0].payload as { playwrightRepro: unknown };
      expect(payload.playwrightRepro).toBeDefined();
    });
  });

  describe('unexpected error path', () => {
    it('escalates to factory:needs-human on dispatchWave error', async () => {
      mockDispatchWave.mockRejectedValueOnce(new Error('Runtime failure'));

      const source = makeMockSource();
      const { runInvestigateWorkflow } = await import('./workflow.js');
      await runInvestigateWorkflow(makeWorkItem(), source, 'goose-hub-self', '/repo');

      expect(source.transitionState).toHaveBeenCalledWith(
        '42',
        'factory:investigating',
        'factory:needs-human',
      );
    });

    it('still cleans up worktree after error', async () => {
      mockDispatchWave.mockRejectedValueOnce(new Error('Runtime failure'));

      const { cleanupWorktree } = await import('@goose-hub/core/workspaces/worktree.js');
      const { runInvestigateWorkflow } = await import('./workflow.js');
      await runInvestigateWorkflow(makeWorkItem(), makeMockSource(), 'goose-hub-self', '/repo');

      expect(cleanupWorktree).toHaveBeenCalledOnce();
    });

    it('posts a comment on unexpected error', async () => {
      mockDispatchWave.mockRejectedValueOnce(new Error('Runtime failure'));

      const source = makeMockSource();
      const { runInvestigateWorkflow } = await import('./workflow.js');
      await runInvestigateWorkflow(makeWorkItem(), source, 'goose-hub-self', '/repo');

      expect(source.comment).toHaveBeenCalled();
    });

    it('records persona failure stat on error', async () => {
      mockDispatchWave.mockRejectedValueOnce(new Error('Runtime failure'));

      const { runInvestigateWorkflow } = await import('./workflow.js');
      await runInvestigateWorkflow(makeWorkItem(), makeMockSource(), 'goose-hub-self', '/repo');

      expect(mockAccumulatePersonaStats).toHaveBeenCalledWith(
        expect.objectContaining({ outcome: 'failure' }),
      );
    });
  });

  describe('symbol index pre-lookup — acceptance criterion (issue #724)', () => {
    it('injects symbolIndexHints into scout-code-path extraContext when hints found', async () => {
      const hints = [
        { name: 'AuthService', definedIn: 'core/auth.ts', line: 10, kind: 'function', callers: [] },
      ];
      mockLookupWorkItemSymbols.mockReturnValue(hints);

      const { runInvestigateWorkflow } = await import('./workflow.js');
      await runInvestigateWorkflow(makeWorkItem(), makeMockSource(), 'goose-hub-self', '/repo');

      const wave1Opts = mockDispatchWave.mock.calls[0][0] as {
        scoutSpecs: Array<{ scoutName: string; extraContext?: Record<string, unknown> }>;
      };
      const codePath = wave1Opts.scoutSpecs.find((s) => s.scoutName === 'scout-code-path');
      expect(codePath?.extraContext).toEqual({ symbolIndexHints: hints });
    });

    it('does not inject extraContext when symbol index returns empty', async () => {
      mockLookupWorkItemSymbols.mockReturnValue([]);

      const { runInvestigateWorkflow } = await import('./workflow.js');
      await runInvestigateWorkflow(makeWorkItem(), makeMockSource(), 'goose-hub-self', '/repo');

      const wave1Opts = mockDispatchWave.mock.calls[0][0] as {
        scoutSpecs: Array<{ scoutName: string; extraContext?: Record<string, unknown> }>;
      };
      const codePath = wave1Opts.scoutSpecs.find((s) => s.scoutName === 'scout-code-path');
      expect(codePath?.extraContext).toBeUndefined();
    });

    it('other Wave 1 scouts are unaffected by symbol index hints', async () => {
      const hints = [
        { name: 'AuthService', definedIn: 'core/auth.ts', line: 10, kind: 'function', callers: [] },
      ];
      mockLookupWorkItemSymbols.mockReturnValue(hints);

      const { runInvestigateWorkflow } = await import('./workflow.js');
      await runInvestigateWorkflow(makeWorkItem(), makeMockSource(), 'goose-hub-self', '/repo');

      const wave1Opts = mockDispatchWave.mock.calls[0][0] as {
        scoutSpecs: Array<{ scoutName: string; extraContext?: Record<string, unknown> }>;
      };
      for (const spec of wave1Opts.scoutSpecs) {
        if (spec.scoutName !== 'scout-code-path') {
          expect(spec.extraContext).toBeUndefined();
        }
      }
    });

    it('lookupWorkItemSymbols called with work item title and body', async () => {
      const workItem = makeWorkItem({ title: 'Fix AuthService', body: 'Crashes on login' });
      mockLookupWorkItemSymbols.mockReturnValue([]);

      const { runInvestigateWorkflow } = await import('./workflow.js');
      await runInvestigateWorkflow(workItem, makeMockSource(), 'goose-hub-self', '/repo');

      expect(mockLookupWorkItemSymbols).toHaveBeenCalledWith('Fix AuthService', 'Crashes on login');
    });
  });
});
