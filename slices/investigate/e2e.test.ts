// slices/investigate/e2e.test.ts
// End-to-end test for the M6 investigation workflow.
// Mocks external I/O (git, claude CLI, filesystem) but exercises
// the full call graph: workflow → worktree → skills → event store → state transitions.

import type { AgentResult } from '@goose-hub/core/agent-runtime/interface.js';
import type { StateSource, WorkItem } from '@goose-hub/core/state-source/interface.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ─── module mocks ──────────────────────────────────────────────────────────────

// Single shared mock for the runtime run fn — reset in beforeEach
const mockRun = vi.fn();

vi.mock('@goose-hub/core/agent-runtime/claude-cli.js', () => ({
  ClaudeCliRuntime: vi.fn().mockImplementation(() => ({ run: mockRun })),
}));

vi.mock('@goose-hub/core/agent-runtime/schema-bridge.js', () => ({
  toJsonSchema: vi.fn().mockReturnValue({}),
}));

vi.mock('@goose-hub/core/agent-runtime/select-persona.js', () => ({
  selectPersona: vi.fn().mockReturnValue('test-project/investigator/0'),
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

// ─── test data ────────────────────────────────────────────────────────────────

// use this exact shape for investigate output
const investigateOutput = {
  findings: 'Root cause: missing null-check in auth middleware at line 42.',
  keyFiles: [
    { path: 'apps/server/src/middleware/auth.ts', reason: 'Null dereference on req.user' },
    { path: 'apps/server/src/domains/auth/service.ts', reason: 'Session token not validated' },
  ],
  confidence: 'high' as const,
  openQuestions: [
    'Does this affect the WebSocket upgrade path?',
    'Is there a test covering the missing token case?',
  ],
  decisionSummaries: [
    { step: 'read-issue', summary: 'Auth crashes when session token is absent' },
    { step: 'traced-callstack', summary: 'req.user accessed before guard in auth.ts:42' },
  ],
};

// use this exact shape for playwright repro output
const playwrightReproOutput = {
  screenshots: [
    { path: '/tmp/factory-repro/step1.png', caption: 'Login form loaded', step: 1 },
    { path: '/tmp/factory-repro/step3.png', caption: '500 error visible after submit', step: 3 },
  ],
  videoPath: '/tmp/factory-repro/session.webm',
  consoleErrors: [
    {
      message: "TypeError: Cannot read properties of undefined (reading 'id')",
      type: 'error' as const,
    },
    { message: 'POST /api/auth/login 500 Internal Server Error', type: 'error' as const },
  ],
  reproSteps: [
    'Navigate to http://localhost:3000/login',
    'Enter username: testuser, password: testpass',
    'Click the Submit button',
    'Observe 500 Internal Server Error in console',
  ],
  reproduced: true,
  notes: 'Bug reproduces 100% of the time with any valid credentials.',
};

// ─── helpers ──────────────────────────────────────────────────────────────────

function makeWorkItem(overrides: Partial<WorkItem> = {}): WorkItem {
  return {
    id: 'github:shaunnez/goose-hub#42',
    externalId: '42',
    repoRef: 'shaunnez/goose-hub',
    title: 'Fix auth bug',
    body: 'Auth breaks on login.\n\nRepro steps:\n1. Go to /login\n2. Enter username: testuser, password: testpass\n3. Click Submit\n4. Observe 500 Internal Server Error',
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
  mockRun.mockReset();
  vi.clearAllMocks();
});

// ─── Scenario 1: Full bug investigation flow ──────────────────────────────────

describe('Scenario 1: Full bug investigation flow', () => {
  it('createWorktree is called with target repo and a non-empty runId', async () => {
    const item = makeWorkItem({ type: 'bug' });
    const source = makeMockSource();

    mockRun
      .mockResolvedValueOnce({
        output: investigateOutput,
        decisionSummaries: [],
        events: [],
      } satisfies AgentResult)
      .mockResolvedValueOnce({
        output: playwrightReproOutput,
        decisionSummaries: [],
        events: [],
      } satisfies AgentResult);

    const { createWorktree } = await import('@goose-hub/core/workspaces/worktree.js');
    const { runInvestigateWorkflow } = await import('./workflow.js');
    await runInvestigateWorkflow(item, source, 'goose-hub-self', '/path/to/repo');

    expect(createWorktree).toHaveBeenCalledWith('/path/to/repo', expect.any(String));
    const runId = vi.mocked(createWorktree).mock.calls[0][1] as string;
    expect(runId.length).toBeGreaterThan(0);
  });

  it('investigate skill is called with required AgentSpec fields', async () => {
    const item = makeWorkItem({ type: 'bug' });
    const source = makeMockSource();

    mockRun
      .mockResolvedValueOnce({
        output: investigateOutput,
        decisionSummaries: [],
        events: [],
      } satisfies AgentResult)
      .mockResolvedValueOnce({
        output: playwrightReproOutput,
        decisionSummaries: [],
        events: [],
      } satisfies AgentResult);

    const { runInvestigateWorkflow } = await import('./workflow.js');
    await runInvestigateWorkflow(item, source, 'goose-hub-self', '/path/to/repo');

    const firstCall = mockRun.mock.calls[0][0] as {
      role: string;
      skill: string;
      toolBundles: string[];
      modelOverride: string;
      personaId: string;
    };
    expect(firstCall.role).toBe('investigator');
    expect(firstCall.skill).toBe('investigate');
    expect(firstCall.toolBundles).toContain('read');
    expect(firstCall.modelOverride).toBe('claude-opus-4-7');
    expect(firstCall.personaId).toBe('test-project/investigator/0');
  });

  it('playwright-repro skill is called as second agent invocation for type:bug', async () => {
    const item = makeWorkItem({ type: 'bug' });
    const source = makeMockSource();

    mockRun
      .mockResolvedValueOnce({
        output: investigateOutput,
        decisionSummaries: [],
        events: [],
      } satisfies AgentResult)
      .mockResolvedValueOnce({
        output: playwrightReproOutput,
        decisionSummaries: [],
        events: [],
      } satisfies AgentResult);

    const { runInvestigateWorkflow } = await import('./workflow.js');
    await runInvestigateWorkflow(item, source, 'goose-hub-self', '/path/to/repo');

    expect(mockRun).toHaveBeenCalledTimes(2);
    const secondCall = mockRun.mock.calls[1][0] as { skill: string };
    expect(secondCall.skill).toBe('playwright-repro');
  });

  it('appendEvent is called with kind: agent.investigation-complete', async () => {
    const item = makeWorkItem({ type: 'bug' });
    const source = makeMockSource();

    mockRun
      .mockResolvedValueOnce({
        output: investigateOutput,
        decisionSummaries: [],
        events: [],
      } satisfies AgentResult)
      .mockResolvedValueOnce({
        output: playwrightReproOutput,
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
  });

  it('persisted event payload contains all investigate fields', async () => {
    const item = makeWorkItem({ type: 'bug' });
    const source = makeMockSource();

    mockRun
      .mockResolvedValueOnce({
        output: investigateOutput,
        decisionSummaries: [],
        events: [],
      } satisfies AgentResult)
      .mockResolvedValueOnce({
        output: playwrightReproOutput,
        decisionSummaries: [],
        events: [],
      } satisfies AgentResult);

    const { runInvestigateWorkflow } = await import('./workflow.js');
    const { eventStore } = await import('@goose-hub/core/event-stream/store.js');
    await runInvestigateWorkflow(item, source, 'goose-hub-self', '/path/to/repo');

    const call = vi
      .mocked(eventStore.appendEvent)
      .mock.calls.find(([e]) => e.kind === 'agent.investigation-complete');
    const payload = call?.[0].payload as {
      investigate: {
        findings: unknown;
        keyFiles: unknown;
        confidence: unknown;
        openQuestions: unknown;
      };
      playwrightRepro: { screenshots: unknown; reproSteps: unknown; reproduced: unknown };
    };

    expect(payload.investigate.findings).toBeDefined();
    expect(payload.investigate.keyFiles).toBeDefined();
    expect(payload.investigate.confidence).toBeDefined();
    expect(payload.investigate.openQuestions).toBeDefined();
    expect(payload.playwrightRepro.screenshots).toBeDefined();
    expect(payload.playwrightRepro.reproSteps).toBeDefined();
    expect(payload.playwrightRepro.reproduced).toBeDefined();
  });

  it('transitionState is called with factory:investigating → factory:investigation-complete', async () => {
    const item = makeWorkItem({ type: 'bug' });
    const source = makeMockSource();

    mockRun
      .mockResolvedValueOnce({
        output: investigateOutput,
        decisionSummaries: [],
        events: [],
      } satisfies AgentResult)
      .mockResolvedValueOnce({
        output: playwrightReproOutput,
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
  });

  it('cleanupWorktree is called for idempotent cleanup', async () => {
    const item = makeWorkItem({ type: 'bug' });
    const source = makeMockSource();

    mockRun
      .mockResolvedValueOnce({
        output: investigateOutput,
        decisionSummaries: [],
        events: [],
      } satisfies AgentResult)
      .mockResolvedValueOnce({
        output: playwrightReproOutput,
        decisionSummaries: [],
        events: [],
      } satisfies AgentResult);

    const { cleanupWorktree } = await import('@goose-hub/core/workspaces/worktree.js');
    const { runInvestigateWorkflow } = await import('./workflow.js');
    await runInvestigateWorkflow(item, source, 'goose-hub-self', '/path/to/repo');

    expect(cleanupWorktree).toHaveBeenCalledOnce();
  });

  it('stateSource.comment is NOT called on success', async () => {
    const item = makeWorkItem({ type: 'bug' });
    const source = makeMockSource();

    mockRun
      .mockResolvedValueOnce({
        output: investigateOutput,
        decisionSummaries: [],
        events: [],
      } satisfies AgentResult)
      .mockResolvedValueOnce({
        output: playwrightReproOutput,
        decisionSummaries: [],
        events: [],
      } satisfies AgentResult);

    const { runInvestigateWorkflow } = await import('./workflow.js');
    await runInvestigateWorkflow(item, source, 'goose-hub-self', '/path/to/repo');

    expect(source.comment).not.toHaveBeenCalled();
  });
});

// ─── Scenario 2: Investigation tab data — key files and confidence ─────────────

describe('Scenario 2: Investigation tab data — key files and confidence', () => {
  it('investigate.confidence is high', async () => {
    const item = makeWorkItem({ type: 'bug' });
    const source = makeMockSource();

    mockRun
      .mockResolvedValueOnce({
        output: investigateOutput,
        decisionSummaries: [],
        events: [],
      } satisfies AgentResult)
      .mockResolvedValueOnce({
        output: playwrightReproOutput,
        decisionSummaries: [],
        events: [],
      } satisfies AgentResult);

    const { runInvestigateWorkflow } = await import('./workflow.js');
    const { eventStore } = await import('@goose-hub/core/event-stream/store.js');
    await runInvestigateWorkflow(item, source, 'goose-hub-self', '/path/to/repo');

    const call = vi
      .mocked(eventStore.appendEvent)
      .mock.calls.find(([e]) => e.kind === 'agent.investigation-complete');
    const payload = call?.[0].payload as { investigate: { confidence: string } };
    expect(payload.investigate.confidence).toBe('high');
  });

  it('investigate.keyFiles[0].path is a non-empty string', async () => {
    const item = makeWorkItem({ type: 'bug' });
    const source = makeMockSource();

    mockRun
      .mockResolvedValueOnce({
        output: investigateOutput,
        decisionSummaries: [],
        events: [],
      } satisfies AgentResult)
      .mockResolvedValueOnce({
        output: playwrightReproOutput,
        decisionSummaries: [],
        events: [],
      } satisfies AgentResult);

    const { runInvestigateWorkflow } = await import('./workflow.js');
    const { eventStore } = await import('@goose-hub/core/event-stream/store.js');
    await runInvestigateWorkflow(item, source, 'goose-hub-self', '/path/to/repo');

    const call = vi
      .mocked(eventStore.appendEvent)
      .mock.calls.find(([e]) => e.kind === 'agent.investigation-complete');
    const payload = call?.[0].payload as {
      investigate: { keyFiles: Array<{ path: string; reason: string }> };
    };
    expect(payload.investigate.keyFiles[0].path).toBeTypeOf('string');
    expect(payload.investigate.keyFiles[0].path.length).toBeGreaterThan(0);
  });

  it('investigate.keyFiles[0].reason is a non-empty string', async () => {
    const item = makeWorkItem({ type: 'bug' });
    const source = makeMockSource();

    mockRun
      .mockResolvedValueOnce({
        output: investigateOutput,
        decisionSummaries: [],
        events: [],
      } satisfies AgentResult)
      .mockResolvedValueOnce({
        output: playwrightReproOutput,
        decisionSummaries: [],
        events: [],
      } satisfies AgentResult);

    const { runInvestigateWorkflow } = await import('./workflow.js');
    const { eventStore } = await import('@goose-hub/core/event-stream/store.js');
    await runInvestigateWorkflow(item, source, 'goose-hub-self', '/path/to/repo');

    const call = vi
      .mocked(eventStore.appendEvent)
      .mock.calls.find(([e]) => e.kind === 'agent.investigation-complete');
    const payload = call?.[0].payload as {
      investigate: { keyFiles: Array<{ path: string; reason: string }> };
    };
    expect(payload.investigate.keyFiles[0].reason).toBeTypeOf('string');
    expect(payload.investigate.keyFiles[0].reason.length).toBeGreaterThan(0);
  });

  it('investigate.openQuestions is an array', async () => {
    const item = makeWorkItem({ type: 'bug' });
    const source = makeMockSource();

    mockRun
      .mockResolvedValueOnce({
        output: investigateOutput,
        decisionSummaries: [],
        events: [],
      } satisfies AgentResult)
      .mockResolvedValueOnce({
        output: playwrightReproOutput,
        decisionSummaries: [],
        events: [],
      } satisfies AgentResult);

    const { runInvestigateWorkflow } = await import('./workflow.js');
    const { eventStore } = await import('@goose-hub/core/event-stream/store.js');
    await runInvestigateWorkflow(item, source, 'goose-hub-self', '/path/to/repo');

    const call = vi
      .mocked(eventStore.appendEvent)
      .mock.calls.find(([e]) => e.kind === 'agent.investigation-complete');
    const payload = call?.[0].payload as { investigate: { openQuestions: unknown[] } };
    expect(Array.isArray(payload.investigate.openQuestions)).toBe(true);
  });
});

// ─── Scenario 3: Code tab data — Playwright capture present ───────────────────

describe('Scenario 3: Code tab data — Playwright capture present', () => {
  it('playwrightRepro.screenshots is a non-empty array with path, caption, step', async () => {
    const item = makeWorkItem({ type: 'bug' });
    const source = makeMockSource();

    mockRun
      .mockResolvedValueOnce({
        output: investigateOutput,
        decisionSummaries: [],
        events: [],
      } satisfies AgentResult)
      .mockResolvedValueOnce({
        output: playwrightReproOutput,
        decisionSummaries: [],
        events: [],
      } satisfies AgentResult);

    const { runInvestigateWorkflow } = await import('./workflow.js');
    const { eventStore } = await import('@goose-hub/core/event-stream/store.js');
    await runInvestigateWorkflow(item, source, 'goose-hub-self', '/path/to/repo');

    const call = vi
      .mocked(eventStore.appendEvent)
      .mock.calls.find(([e]) => e.kind === 'agent.investigation-complete');
    const payload = call?.[0].payload as {
      playwrightRepro: { screenshots: Array<{ path: string; caption: string; step: number }> };
    };

    expect(Array.isArray(payload.playwrightRepro.screenshots)).toBe(true);
    expect(payload.playwrightRepro.screenshots.length).toBeGreaterThan(0);
    const screenshot = payload.playwrightRepro.screenshots[0];
    expect(screenshot.path).toBeTypeOf('string');
    expect(screenshot.caption).toBeTypeOf('string');
    expect(screenshot.step).toBeTypeOf('number');
  });

  it('playwrightRepro.consoleErrors includes at least one error', async () => {
    const item = makeWorkItem({ type: 'bug' });
    const source = makeMockSource();

    mockRun
      .mockResolvedValueOnce({
        output: investigateOutput,
        decisionSummaries: [],
        events: [],
      } satisfies AgentResult)
      .mockResolvedValueOnce({
        output: playwrightReproOutput,
        decisionSummaries: [],
        events: [],
      } satisfies AgentResult);

    const { runInvestigateWorkflow } = await import('./workflow.js');
    const { eventStore } = await import('@goose-hub/core/event-stream/store.js');
    await runInvestigateWorkflow(item, source, 'goose-hub-self', '/path/to/repo');

    const call = vi
      .mocked(eventStore.appendEvent)
      .mock.calls.find(([e]) => e.kind === 'agent.investigation-complete');
    const payload = call?.[0].payload as {
      playwrightRepro: { consoleErrors: Array<{ message: string; type: string }> };
    };

    expect(payload.playwrightRepro.consoleErrors.length).toBeGreaterThan(0);
    const hasError = payload.playwrightRepro.consoleErrors.some((e) => e.type === 'error');
    expect(hasError).toBe(true);
  });

  it('playwrightRepro.reproSteps is a non-empty array', async () => {
    const item = makeWorkItem({ type: 'bug' });
    const source = makeMockSource();

    mockRun
      .mockResolvedValueOnce({
        output: investigateOutput,
        decisionSummaries: [],
        events: [],
      } satisfies AgentResult)
      .mockResolvedValueOnce({
        output: playwrightReproOutput,
        decisionSummaries: [],
        events: [],
      } satisfies AgentResult);

    const { runInvestigateWorkflow } = await import('./workflow.js');
    const { eventStore } = await import('@goose-hub/core/event-stream/store.js');
    await runInvestigateWorkflow(item, source, 'goose-hub-self', '/path/to/repo');

    const call = vi
      .mocked(eventStore.appendEvent)
      .mock.calls.find(([e]) => e.kind === 'agent.investigation-complete');
    const payload = call?.[0].payload as { playwrightRepro: { reproSteps: string[] } };

    expect(Array.isArray(payload.playwrightRepro.reproSteps)).toBe(true);
    expect(payload.playwrightRepro.reproSteps.length).toBeGreaterThan(0);
  });

  it('playwrightRepro.reproduced is true', async () => {
    const item = makeWorkItem({ type: 'bug' });
    const source = makeMockSource();

    mockRun
      .mockResolvedValueOnce({
        output: investigateOutput,
        decisionSummaries: [],
        events: [],
      } satisfies AgentResult)
      .mockResolvedValueOnce({
        output: playwrightReproOutput,
        decisionSummaries: [],
        events: [],
      } satisfies AgentResult);

    const { runInvestigateWorkflow } = await import('./workflow.js');
    const { eventStore } = await import('@goose-hub/core/event-stream/store.js');
    await runInvestigateWorkflow(item, source, 'goose-hub-self', '/path/to/repo');

    const call = vi
      .mocked(eventStore.appendEvent)
      .mock.calls.find(([e]) => e.kind === 'agent.investigation-complete');
    const payload = call?.[0].payload as { playwrightRepro: { reproduced: boolean } };

    expect(payload.playwrightRepro.reproduced).toBe(true);
  });
});

// ─── Scenario 4: Issue ends in factory:investigation-complete ─────────────────

describe('Scenario 4: Issue ends in factory:investigation-complete', () => {
  it('transitionState is called with the correct state pair', async () => {
    const item = makeWorkItem({ type: 'bug' });
    const source = makeMockSource();

    mockRun
      .mockResolvedValueOnce({
        output: investigateOutput,
        decisionSummaries: [],
        events: [],
      } satisfies AgentResult)
      .mockResolvedValueOnce({
        output: playwrightReproOutput,
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
  });

  it('transition target is factory:investigation-complete — the terminal M6 state ready for dev', async () => {
    const item = makeWorkItem({ type: 'bug' });
    const source = makeMockSource();

    mockRun
      .mockResolvedValueOnce({
        output: investigateOutput,
        decisionSummaries: [],
        events: [],
      } satisfies AgentResult)
      .mockResolvedValueOnce({
        output: playwrightReproOutput,
        decisionSummaries: [],
        events: [],
      } satisfies AgentResult);

    const { runInvestigateWorkflow } = await import('./workflow.js');
    await runInvestigateWorkflow(item, source, 'goose-hub-self', '/path/to/repo');

    const calls = vi.mocked(source.transitionState).mock.calls;
    const terminalTransition = calls.find(([, , to]) => to === 'factory:investigation-complete');
    expect(terminalTransition).toBeDefined();
    // factory:investigation-complete is the terminal M6 state (issue ready for dev)
    expect(terminalTransition?.[2]).toBe('factory:investigation-complete');
  });
});

// ─── Scenario 5: Worktree is always cleaned up (failure path) ─────────────────

describe('Scenario 5: Worktree is always cleaned up (failure path)', () => {
  it('cleanupWorktree still called when mockRun throws on first call', async () => {
    const item = makeWorkItem({ type: 'bug' });
    const source = makeMockSource();

    mockRun.mockRejectedValueOnce(new Error('Agent subprocess crashed'));

    const { cleanupWorktree } = await import('@goose-hub/core/workspaces/worktree.js');
    const { runInvestigateWorkflow } = await import('./workflow.js');
    await runInvestigateWorkflow(item, source, 'goose-hub-self', '/path/to/repo');

    expect(cleanupWorktree).toHaveBeenCalled();
  });

  it('transitionState is called with factory:needs-human on failure', async () => {
    const item = makeWorkItem({ type: 'bug' });
    const source = makeMockSource();

    mockRun.mockRejectedValueOnce(new Error('Agent subprocess crashed'));

    const { runInvestigateWorkflow } = await import('./workflow.js');
    await runInvestigateWorkflow(item, source, 'goose-hub-self', '/path/to/repo');

    expect(source.transitionState).toHaveBeenCalledWith(
      '42',
      'factory:investigating',
      'factory:needs-human',
    );
  });

  it('stateSource.comment is called with error message on failure', async () => {
    const item = makeWorkItem({ type: 'bug' });
    const source = makeMockSource();

    mockRun.mockRejectedValueOnce(new Error('Agent subprocess crashed'));

    const { runInvestigateWorkflow } = await import('./workflow.js');
    await runInvestigateWorkflow(item, source, 'goose-hub-self', '/path/to/repo');

    expect(source.comment).toHaveBeenCalledWith(
      '42',
      expect.stringContaining('Investigation failed'),
    );
  });

  it('appendEvent is called with kind: agent.run-failed on failure', async () => {
    const item = makeWorkItem({ type: 'bug' });
    const source = makeMockSource();

    mockRun.mockRejectedValueOnce(new Error('Agent subprocess crashed'));

    const { runInvestigateWorkflow } = await import('./workflow.js');
    const { eventStore } = await import('@goose-hub/core/event-stream/store.js');
    await runInvestigateWorkflow(item, source, 'goose-hub-self', '/path/to/repo');

    const failCall = vi
      .mocked(eventStore.appendEvent)
      .mock.calls.find(([e]) => e.kind === 'agent.run-failed');
    expect(failCall).toBeDefined();
  });
});

// ─── Scenario 6: Non-bug issue skips playwright-repro ─────────────────────────

describe('Scenario 6: Non-bug issue skips playwright-repro', () => {
  it('mockRun called exactly once for type:chore — no playwright-repro', async () => {
    const item = makeWorkItem({ type: 'chore' });
    const source = makeMockSource();

    mockRun.mockResolvedValueOnce({
      output: investigateOutput,
      decisionSummaries: [],
      events: [],
    } satisfies AgentResult);

    const { runInvestigateWorkflow } = await import('./workflow.js');
    await runInvestigateWorkflow(item, source, 'goose-hub-self', '/path/to/repo');

    expect(mockRun).toHaveBeenCalledTimes(1);
  });

  it('event payload has investigate but no playwrightRepro for non-bug', async () => {
    const item = makeWorkItem({ type: 'chore' });
    const source = makeMockSource();

    mockRun.mockResolvedValueOnce({
      output: investigateOutput,
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
    const payload = call?.[0].payload as { investigate: unknown; playwrightRepro: unknown };
    expect(payload.investigate).toBeDefined();
    expect(payload.playwrightRepro).toBeUndefined();
  });

  it('no playwright-repro for type:feature', async () => {
    const item = makeWorkItem({ type: 'feature' });
    const source = makeMockSource();

    mockRun.mockResolvedValueOnce({
      output: investigateOutput,
      decisionSummaries: [],
      events: [],
    } satisfies AgentResult);

    const { runInvestigateWorkflow } = await import('./workflow.js');
    await runInvestigateWorkflow(item, source, 'goose-hub-self', '/path/to/repo');

    expect(mockRun).toHaveBeenCalledTimes(1);
    const firstCall = mockRun.mock.calls[0][0] as { skill: string };
    expect(firstCall.skill).toBe('investigate');
  });
});
