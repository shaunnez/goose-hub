import type { AgentResult } from '@goose-hub/core/agent-runtime/interface.js';
import type { StateSource, WorkItem } from '@goose-hub/core/state-source/interface.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ─── module mocks ──────────────────────────────────────────────────────────────

// Single shared mock for the runtime run fn — reset in beforeEach
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

function makeInvestigateOutput() {
  return {
    findings: 'Root cause is a null-check missing in auth middleware.',
    keyFiles: [{ path: 'apps/server/src/middleware/auth.ts', reason: 'Contains null-dereference' }],
    confidence: 'high',
    openQuestions: ['Does this also affect WebSocket upgrade path?'],
    decisionSummaries: [
      {
        step: 'issue-read',
        summary: 'Read issue #42: auth middleware crashes on missing session token',
      },
    ],
  };
}

function makePlaywrightReproOutput() {
  return {
    screenshots: [{ path: '/tmp/screenshot.png', caption: 'Login error visible', step: 3 }],
    videoPath: null,
    consoleErrors: [
      { message: 'TypeError: Cannot read property of undefined', type: 'error' as const },
    ],
    reproSteps: ['Navigate to /login', 'Enter credentials', 'Click submit'],
    reproduced: true,
    notes: 'Bug reproduced consistently.',
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
    watchForUpdates: vi.fn(),
    ...overrides,
  };
}

// ─── test setup ───────────────────────────────────────────────────────────────

beforeEach(() => {
  // Reset call history and queued return values on all mocks.
  // mockRun is a hoisted vi.fn() so we reset it directly.
  // vi.clearAllMocks() only clears call history, not return value queues,
  // so we use mockReset() on the shared run mock to prevent once-value leakage.
  mockRun.mockReset();
  // Clear call history on the module-level mocks so per-test counts are accurate.
  vi.clearAllMocks();
  mockAccumulatePersonaStats.mockClear();
  // Re-set mockRun after clearAllMocks since clearAllMocks doesn't remove implementations
  // but does reset the cleared call counters — the mockReset above already cleared the queue.
});

// ─── tests ────────────────────────────────────────────────────────────────────

describe('runInvestigateWorkflow', () => {
  describe('happy path — non-bug type', () => {
    it('creates a worktree with the target repo and runId', async () => {
      const item = makeWorkItem({ type: 'chore' });
      const source = makeMockSource();

      mockRun.mockResolvedValueOnce({
        output: makeInvestigateOutput(),
        decisionSummaries: [],
        events: [],
      } satisfies AgentResult);

      const { createWorktree } = await import('@goose-hub/core/workspaces/worktree.js');
      const { runInvestigateWorkflow } = await import('./workflow.js');
      await runInvestigateWorkflow(item, source, 'goose-hub-self', '/path/to/repo');

      expect(createWorktree).toHaveBeenCalledWith('/path/to/repo', expect.any(String));
    });

    it('runs the investigate skill once for a non-bug item', async () => {
      const item = makeWorkItem({ type: 'chore' });
      const source = makeMockSource();

      mockRun.mockResolvedValueOnce({
        output: makeInvestigateOutput(),
        decisionSummaries: [],
        events: [],
      } satisfies AgentResult);

      const { runInvestigateWorkflow } = await import('./workflow.js');
      await runInvestigateWorkflow(item, source, 'goose-hub-self', '/path/to/repo');

      expect(mockRun).toHaveBeenCalledTimes(1);
      const callArg = mockRun.mock.calls[0][0] as { skill: string };
      expect(callArg.skill).toBe('investigate');
    });

    it('persists agent.investigation-complete event with findings', async () => {
      const item = makeWorkItem({ type: 'chore' });
      const source = makeMockSource();

      mockRun.mockResolvedValueOnce({
        output: makeInvestigateOutput(),
        decisionSummaries: [],
        events: [],
      } satisfies AgentResult);

      const { runInvestigateWorkflow } = await import('./workflow.js');
      const { eventStore } = await import('@goose-hub/core/event-stream/store.js');
      await runInvestigateWorkflow(item, source, 'goose-hub-self', '/path/to/repo');

      const call = vi
        .mocked(eventStore.appendEvent)
        .mock.calls.find(([e]) => e.kind === 'agent.investigation-complete');
      expect(call).toBeDefined();
      const payload = call?.[0].payload as { investigate: unknown };
      expect(payload.investigate).toBeDefined();
    });

    it('transitions state from factory:investigating to factory:investigation-complete', async () => {
      const item = makeWorkItem({ type: 'chore' });
      const source = makeMockSource();

      mockRun.mockResolvedValueOnce({
        output: makeInvestigateOutput(),
        decisionSummaries: [],
        events: [],
      } satisfies AgentResult);

      const { runInvestigateWorkflow } = await import('./workflow.js');
      await runInvestigateWorkflow(item, source, 'goose-hub-self', '/path/to/repo');

      expect(source.transitionState).toHaveBeenCalledWith(
        '42',
        'factory:investigating',
        'factory:investigation-complete',
      );
      expect(mockAccumulatePersonaStats).toHaveBeenCalledWith({
        personaName: 'test-project/investigator/0',
        role: 'investigator',
        outcome: 'success',
      });
    });

    it('always cleans up the worktree via finally block', async () => {
      const item = makeWorkItem({ type: 'chore' });
      const source = makeMockSource();

      mockRun.mockResolvedValueOnce({
        output: makeInvestigateOutput(),
        decisionSummaries: [],
        events: [],
      } satisfies AgentResult);

      const { cleanupWorktree } = await import('@goose-hub/core/workspaces/worktree.js');
      const { runInvestigateWorkflow } = await import('./workflow.js');
      await runInvestigateWorkflow(item, source, 'goose-hub-self', '/path/to/repo');

      expect(cleanupWorktree).toHaveBeenCalledOnce();
    });
  });

  describe('bug type — playwright-repro also runs', () => {
    it('runs both investigate and playwright-repro skills for type:bug', async () => {
      const item = makeWorkItem({ type: 'bug' });
      const source = makeMockSource();

      mockRun
        .mockResolvedValueOnce({
          output: makeInvestigateOutput(),
          decisionSummaries: [],
          events: [],
        } satisfies AgentResult)
        .mockResolvedValueOnce({
          output: makePlaywrightReproOutput(),
          decisionSummaries: [],
          events: [],
        } satisfies AgentResult);

      const { runInvestigateWorkflow } = await import('./workflow.js');
      await runInvestigateWorkflow(item, source, 'goose-hub-self', '/path/to/repo');

      expect(mockRun).toHaveBeenCalledTimes(2);
      const firstCall = mockRun.mock.calls[0][0] as { skill: string };
      const secondCall = mockRun.mock.calls[1][0] as { skill: string };
      expect(firstCall.skill).toBe('investigate');
      expect(secondCall.skill).toBe('playwright-repro');
    });

    it('persists playwrightRepro in investigation-complete event for type:bug', async () => {
      const item = makeWorkItem({ type: 'bug' });
      const source = makeMockSource();

      mockRun
        .mockResolvedValueOnce({
          output: makeInvestigateOutput(),
          decisionSummaries: [],
          events: [],
        } satisfies AgentResult)
        .mockResolvedValueOnce({
          output: makePlaywrightReproOutput(),
          decisionSummaries: [],
          events: [],
        } satisfies AgentResult);

      const { runInvestigateWorkflow } = await import('./workflow.js');
      const { eventStore } = await import('@goose-hub/core/event-stream/store.js');
      await runInvestigateWorkflow(item, source, 'goose-hub-self', '/path/to/repo');

      const call = vi
        .mocked(eventStore.appendEvent)
        .mock.calls.find(([e]) => e.kind === 'agent.investigation-complete');
      expect(call).toBeDefined();
      const payload = call?.[0].payload as { playwrightRepro: unknown };
      expect(payload.playwrightRepro).toBeDefined();
    });

    it('uses validate tool bundle for playwright-repro skill', async () => {
      const item = makeWorkItem({ type: 'bug' });
      const source = makeMockSource();

      mockRun
        .mockResolvedValueOnce({
          output: makeInvestigateOutput(),
          decisionSummaries: [],
          events: [],
        } satisfies AgentResult)
        .mockResolvedValueOnce({
          output: makePlaywrightReproOutput(),
          decisionSummaries: [],
          events: [],
        } satisfies AgentResult);

      const { runInvestigateWorkflow } = await import('./workflow.js');
      await runInvestigateWorkflow(item, source, 'goose-hub-self', '/path/to/repo');

      const playwrightCall = mockRun.mock.calls[1][0] as { toolBundles: string[] };
      expect(playwrightCall.toolBundles).toContain('playwright-mcp');
    });

    it('does NOT run playwright-repro for non-bug items', async () => {
      for (const type of ['feature', 'chore', 'research'] as const) {
        mockRun.mockReset();
        mockRun.mockResolvedValueOnce({
          output: makeInvestigateOutput(),
          decisionSummaries: [],
          events: [],
        } satisfies AgentResult);

        const item = makeWorkItem({ type });
        const source = makeMockSource();

        const { runInvestigateWorkflow } = await import('./workflow.js');
        await runInvestigateWorkflow(item, source, 'goose-hub-self', '/path/to/repo');

        expect(mockRun).toHaveBeenCalledTimes(1);
      }
    });
  });

  describe('failure path', () => {
    it('cleans up worktree on failure', async () => {
      const item = makeWorkItem({ type: 'chore' });
      const source = makeMockSource();

      mockRun.mockRejectedValueOnce(new Error('Agent failed'));

      const { cleanupWorktree } = await import('@goose-hub/core/workspaces/worktree.js');
      const { runInvestigateWorkflow } = await import('./workflow.js');
      await runInvestigateWorkflow(item, source, 'goose-hub-self', '/path/to/repo');

      // cleanupWorktree is called in finally — always runs
      expect(cleanupWorktree).toHaveBeenCalled();
    });

    it('transitions to factory:needs-human on failure', async () => {
      const item = makeWorkItem({ type: 'chore' });
      const source = makeMockSource();

      mockRun.mockRejectedValueOnce(new Error('Subprocess error'));

      const { runInvestigateWorkflow } = await import('./workflow.js');
      await runInvestigateWorkflow(item, source, 'goose-hub-self', '/path/to/repo');

      expect(source.transitionState).toHaveBeenCalledWith(
        '42',
        'factory:investigating',
        'factory:needs-human',
      );
      expect(mockAccumulatePersonaStats).toHaveBeenCalledWith({
        personaName: 'test-project/investigator/0',
        role: 'investigator',
        outcome: 'failure',
      });
    });

    it('posts a GitHub comment on failure', async () => {
      const item = makeWorkItem({ type: 'chore' });
      const source = makeMockSource();
      const errorMessage = 'Subprocess timed out';

      mockRun.mockRejectedValueOnce(new Error(errorMessage));

      const { runInvestigateWorkflow } = await import('./workflow.js');
      await runInvestigateWorkflow(item, source, 'goose-hub-self', '/path/to/repo');

      expect(source.comment).toHaveBeenCalledWith(
        '42',
        expect.stringContaining('Investigation failed'),
      );
    });

    it('persists agent.run-failed event on failure', async () => {
      const item = makeWorkItem({ type: 'chore' });
      const source = makeMockSource();

      mockRun.mockRejectedValueOnce(new Error('Runtime crashed'));

      const { runInvestigateWorkflow } = await import('./workflow.js');
      const { eventStore } = await import('@goose-hub/core/event-stream/store.js');
      await runInvestigateWorkflow(item, source, 'goose-hub-self', '/path/to/repo');

      const failCall = vi
        .mocked(eventStore.appendEvent)
        .mock.calls.find(([e]) => e.kind === 'agent.run-failed');
      expect(failCall).toBeDefined();
    });

    it('does not throw — handles errors gracefully', async () => {
      const item = makeWorkItem({ type: 'chore' });
      const source = makeMockSource();

      mockRun.mockRejectedValueOnce(new Error('Unexpected crash'));

      const { runInvestigateWorkflow } = await import('./workflow.js');
      await expect(
        runInvestigateWorkflow(item, source, 'goose-hub-self', '/path/to/repo'),
      ).resolves.not.toThrow();
    });

    it('handles validation failure as an error — transitions to factory:needs-human', async () => {
      const item = makeWorkItem({ type: 'chore' });
      const source = makeMockSource();

      // Returns invalid output that fails schema validation
      mockRun.mockResolvedValueOnce({
        output: { bad: 'data', missing_required: true },
        decisionSummaries: [],
        events: [],
      } satisfies AgentResult);

      const { runInvestigateWorkflow } = await import('./workflow.js');
      await runInvestigateWorkflow(item, source, 'goose-hub-self', '/path/to/repo');

      expect(source.transitionState).toHaveBeenCalledWith(
        '42',
        'factory:investigating',
        'factory:needs-human',
      );
    });
  });

  describe('AgentSpec fields', () => {
    it('uses opus model override for investigate skill', async () => {
      const item = makeWorkItem({ type: 'chore' });
      const source = makeMockSource();

      mockRun.mockResolvedValueOnce({
        output: makeInvestigateOutput(),
        decisionSummaries: [],
        events: [],
      } satisfies AgentResult);

      const { runInvestigateWorkflow } = await import('./workflow.js');
      await runInvestigateWorkflow(item, source, 'goose-hub-self', '/path/to/repo');

      const callArg = mockRun.mock.calls[0][0] as { modelOverride: string };
      expect(callArg.modelOverride).toBe('claude-opus-4-7');
    });

    it('includes personaId in investigate AgentSpec', async () => {
      const item = makeWorkItem({ type: 'chore' });
      const source = makeMockSource();

      mockRun.mockResolvedValueOnce({
        output: makeInvestigateOutput(),
        decisionSummaries: [],
        events: [],
      } satisfies AgentResult);

      const { runInvestigateWorkflow } = await import('./workflow.js');
      await runInvestigateWorkflow(item, source, 'goose-hub-self', '/path/to/repo');

      const callArg = mockRun.mock.calls[0][0] as { personaId: string };
      expect(callArg.personaId).toBe('test-project/investigator/0');
    });

    it('passes worktreePath in investigate context', async () => {
      const item = makeWorkItem({ type: 'chore' });
      const source = makeMockSource();

      mockRun.mockResolvedValueOnce({
        output: makeInvestigateOutput(),
        decisionSummaries: [],
        events: [],
      } satisfies AgentResult);

      const { runInvestigateWorkflow } = await import('./workflow.js');
      await runInvestigateWorkflow(item, source, 'goose-hub-self', '/path/to/repo');

      const callArg = mockRun.mock.calls[0][0] as {
        context: Record<string, unknown>;
        contextAllowlist: string[];
      };
      expect(callArg.context.worktreePath).toBe('/tmp/test-worktree');
      expect(callArg.contextAllowlist).toContain('worktreePath');
    });

    it('uses read tool bundle for investigate skill', async () => {
      const item = makeWorkItem({ type: 'chore' });
      const source = makeMockSource();

      mockRun.mockResolvedValueOnce({
        output: makeInvestigateOutput(),
        decisionSummaries: [],
        events: [],
      } satisfies AgentResult);

      const { runInvestigateWorkflow } = await import('./workflow.js');
      await runInvestigateWorkflow(item, source, 'goose-hub-self', '/path/to/repo');

      const callArg = mockRun.mock.calls[0][0] as { toolBundles: string[] };
      expect(callArg.toolBundles).toContain('read-only');
    });
  });
});

describe('investigate — line 138 non-Error catch branch', () => {
  it('wraps non-Error thrown value as Error and transitions to needs-human', async () => {
    const item = makeWorkItem({ type: 'chore' });
    const source = makeMockSource();

    // Throw a string (not an Error object) to cover the false branch of `err instanceof Error`
    // eslint-disable-next-line prefer-promise-reject-errors
    mockRun.mockRejectedValueOnce('string error — not an Error instance');

    const { runInvestigateWorkflow } = await import('./workflow.js');
    await runInvestigateWorkflow(item, source, 'goose-hub-self', '/path/to/repo');

    expect(source.transitionState).toHaveBeenCalledWith(
      '42',
      'factory:investigating',
      'factory:needs-human',
    );
    expect(source.comment).toHaveBeenCalledWith(
      '42',
      expect.stringContaining('Investigation failed'),
    );
  });
});

describe('investigate — playwright-repro parse failure (line 138 branch)', () => {
  it('continues to success when playwright-repro output parse fails (non-fatal)', async () => {
    const item = makeWorkItem({ type: 'bug' });
    const source = makeMockSource();

    mockRun
      .mockResolvedValueOnce({
        output: makeInvestigateOutput(),
        decisionSummaries: [],
        events: [],
      } satisfies AgentResult)
      .mockResolvedValueOnce({
        // Invalid output — PlaywrightReproSchema.safeParse will return success:false
        output: { bad: 'schema', missingFields: true },
        decisionSummaries: [],
        events: [],
      } satisfies AgentResult);

    const { runInvestigateWorkflow } = await import('./workflow.js');
    const { eventStore } = await import('@goose-hub/core/event-stream/store.js');
    await runInvestigateWorkflow(item, source, 'goose-hub-self', '/path/to/repo');

    // Should still transition successfully (playwright-repro failure is non-fatal)
    expect(source.transitionState).toHaveBeenCalledWith(
      '42',
      'factory:investigating',
      'factory:investigation-complete',
    );

    // investigation-complete event should still be emitted
    const call = vi
      .mocked(eventStore.appendEvent)
      .mock.calls.find(([e]) => e.kind === 'agent.investigation-complete');
    expect(call).toBeDefined();

    // playwrightRepro should be undefined (parse failed but non-fatal)
    const payload = call?.[0].payload as { playwrightRepro: unknown };
    expect(payload.playwrightRepro).toBeUndefined();
  });
});

describe('selectPersona', () => {
  it('returns round-robin persona IDs for sequential calls (mocked)', async () => {
    // The actual round-robin is DB-backed; here we verify the mock integration
    const { selectPersona } = await import('@goose-hub/core/agent-runtime/select-persona.js');

    const result = selectPersona('test-project', 'investigator');
    expect(result).toEqual({ personaId: 'test-project/investigator/0', codename: 'Grey Honker' });
    expect(selectPersona).toHaveBeenCalledWith('test-project', 'investigator');
  });
});
