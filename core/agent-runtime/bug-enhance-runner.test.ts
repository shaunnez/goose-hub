import type { GroundedHints } from '@goose-hub/skills/bug-enhance/schema.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ResolvedSkillRuntime } from './skill-runtime-resolver.js';

vi.mock('../event-stream/store.js', () => ({
  eventStore: { appendEvent: vi.fn() },
}));

vi.mock('../projects/loader.js', () => ({
  getProjectBySlug: vi.fn().mockResolvedValue(null),
}));

vi.mock('./skill-runtime-resolver.js', () => ({
  resolveSkillRuntimeForProject: vi.fn().mockReturnValue({
    budgets: { maxTurns: 10, maxBudgetUsd: 0.5, timeoutMs: 30_000 },
    modelOverride: 'claude-sonnet-4-6',
    provider: 'claude',
  }),
}));

vi.mock('./select-persona.js', () => ({
  selectPersona: vi.fn().mockReturnValue({ personaId: 'test/triager/0' }),
}));

const mockRunFn = vi.fn();
vi.mock('./select-runtime.js', () => ({
  selectRuntime: vi.fn().mockReturnValue({ run: mockRunFn }),
}));

vi.mock('./read-prompt.js', () => ({
  readPromptWithContext: vi.fn().mockReturnValue('# mock prompt'),
}));

vi.mock('./schema-bridge.js', () => ({
  toJsonSchema: vi.fn().mockReturnValue({}),
}));

vi.mock('../agent-artifacts/repository.js', () => ({
  storeArtifact: vi.fn(),
}));

vi.mock('../logger.js', () => ({
  logger: { warn: vi.fn(), error: vi.fn() },
}));

// Control existsSync responses per test
let existsSyncImpl: (p: unknown) => boolean = () => true;
let readdirSyncImpl: (p: unknown) => unknown[] = () => [];
let statSyncImpl: (p: unknown) => { isDirectory(): boolean } = () => ({ isDirectory: () => false });
vi.mock('node:fs', () => ({
  existsSync: (p: unknown) => existsSyncImpl(p),
  readdirSync: (p: unknown) => readdirSyncImpl(p),
  statSync: (p: unknown) => statSyncImpl(p),
}));

const { runBugEnhance } = await import('./bug-enhance-runner.js');
const { eventStore } = await import('../event-stream/store.js');
const { resolveSkillRuntimeForProject } = await import('./skill-runtime-resolver.js');

function makeHints(paths: string[]): GroundedHints {
  return {
    candidateFiles: paths.map((p) => ({ path: p, confidence: 'high' as const })),
    candidateComponents: [],
    candidateRoutes: [],
  };
}

function makeToolEvent(toolName: string, overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    projectId: 'goose-hub-self',
    workItemId: 'github:owner/repo#42',
    kind: 'agent.tool-call',
    payload: {
      tool_name: toolName,
      status: 'ok',
      blocked: false,
      ...overrides,
    },
    runId: 'bug-enhance-run',
    personaId: null,
    createdAt: '2026-06-05T00:00:00.000Z',
  };
}

function makeAgentResult(
  hints: GroundedHints | undefined,
  opts: {
    enhancedContent?: string;
    category?: string;
    events?: ReturnType<typeof makeToolEvent>[];
  } = {},
) {
  return {
    output: {
      enhancedContent: opts.enhancedContent ?? 'Enhanced bug content',
      category: opts.category ?? 'ui-web',
      groundedHints: hints,
      decisionSummaries: [{ kind: 'READ', summary: 'done' }],
    },
    decisionSummaries: [],
    events: opts.events ?? [makeToolEvent('mcp__factory-tools__repo_intel.query')],
  };
}

function fakeDirent(name: string, kind: 'file' | 'dir') {
  return {
    name,
    isFile: () => kind === 'file',
    isDirectory: () => kind === 'dir',
  };
}

const BASE_INPUT = {
  projectId: 'goose-hub-self',
  workItemId: 'github:owner/repo#42',
  title: 'Bug title',
  body: 'Bug body',
  workspaceDir: '/repo',
};

function makeResolvedRuntime(provider: 'claude' | 'codex'): ResolvedSkillRuntime {
  const tier = provider === 'codex' ? 'sonnet' : 'haiku';
  const modelOverride = provider === 'codex' ? 'gpt-5-codex' : 'claude-sonnet-4-6';
  return {
    budgets: { maxTurns: 10, maxBudgetUsd: 0.5, timeoutMs: 30_000 },
    modelOverride,
    tier,
    provider,
    source: 'skill-default',
    selectionReason: 'test runtime',
    runtimeTrace: {
      tier: { value: tier, source: 'skill-default', reason: 'test runtime' },
      provider: { value: provider, source: 'skill-default', reason: 'test runtime' },
    },
    resolvedPrimary: { tier, provider, modelId: modelOverride },
    resolvedFallback: null,
    resolvedAdvisor: null,
  };
}

describe('runBugEnhance — path-existence pruning', () => {
  beforeEach(() => {
    mockRunFn.mockClear();
    vi.mocked(resolveSkillRuntimeForProject).mockReturnValue(makeResolvedRuntime('claude'));
    mockRunFn.mockResolvedValue(makeAgentResult(makeHints(['real.ts', 'fake.ts'])));
    vi.mocked(eventStore.appendEvent).mockClear();
    // Default: workspace exists; 'real.ts' exists; 'fake.ts' does not
    existsSyncImpl = (p) => {
      const s = String(p);
      if (s === '/repo') return true;
      if (s === '/repo/real.ts') return true;
      return false;
    };
    readdirSyncImpl = () => [];
    statSyncImpl = () => ({ isDirectory: () => false });
  });

  it('keeps paths that exist and drops paths that do not', async () => {
    const result = await runBugEnhance(BASE_INPUT);
    expect(result.groundedHints?.candidateFiles).toHaveLength(1);
    expect(result.groundedHints?.candidateFiles[0].path).toBe('real.ts');
  });

  it('uses a parent investigation child run id when provided', async () => {
    await runBugEnhance({ ...BASE_INPUT, parentRunId: 'investigate-parent' });

    expect(mockRunFn).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: 'investigate-parent:bug-enhance',
        extraEventPayload: {
          parentRunId: 'investigate-parent',
          investigationRunId: 'investigate-parent',
        },
      }),
    );
  });

  it('emits agent.bug-enhance-hallucinated and returns null when all candidateFiles pruned', async () => {
    mockRunFn.mockResolvedValue(makeAgentResult(makeHints(['fake.ts', 'also-fake.ts'])));

    const result = await runBugEnhance(BASE_INPUT);

    expect(result.groundedHints).toBeNull();
    const calls = vi.mocked(eventStore.appendEvent).mock.calls;
    const hallucinatedEvent = calls.find(([e]) => e.kind === 'agent.bug-enhance-hallucinated');
    expect(hallucinatedEvent).toBeDefined();
    expect(hallucinatedEvent?.[0].payload).toMatchObject({ droppedCount: 2, originalCount: 2 });
  });

  it('does not prune and emits workspace-empty warning when workspaceDir does not exist', async () => {
    existsSyncImpl = () => false;

    const result = await runBugEnhance(BASE_INPUT);

    // Hints passed through unchanged — do not prune on unknown workspace
    expect(result.groundedHints?.candidateFiles).toHaveLength(2);
    const calls = vi.mocked(eventStore.appendEvent).mock.calls;
    const workspaceEmptyEvent = calls.find(([e]) => e.kind === 'agent.bug-enhance-workspace-empty');
    expect(workspaceEmptyEvent).toBeDefined();
  });

  it('prunes non-existent file from candidateComponents too', async () => {
    mockRunFn.mockResolvedValue(
      makeAgentResult({
        candidateFiles: [{ path: 'real.ts', confidence: 'high' }],
        candidateComponents: [
          { name: 'RealComp', file: 'real.ts' },
          { name: 'FakeComp', file: 'fake.ts' },
          { name: 'NoFile' },
        ],
        candidateRoutes: [],
      }),
    );

    const result = await runBugEnhance(BASE_INPUT);

    // FakeComp (file: 'fake.ts') dropped; NoFile (no file field) kept
    const names = result.groundedHints?.candidateComponents.map((c) => c.name);
    expect(names).toContain('RealComp');
    expect(names).toContain('NoFile');
    expect(names).not.toContain('FakeComp');
  });

  it('adds preflight guidance when the issue mentions a stale path with nearby files', async () => {
    mockRunFn.mockResolvedValue(
      makeAgentResult(makeHints(['apps/web/src/components/chat/components/ChatPanel.tsx'])),
    );
    existsSyncImpl = (p) => {
      const s = String(p);
      return (
        s === '/repo' ||
        s === '/repo/apps/web/src/components/chat' ||
        s === '/repo/apps/web/src/components/chat/components' ||
        s === '/repo/apps/web/src/components/chat/components/ChatPanel.tsx'
      );
    };
    statSyncImpl = (p) => ({
      isDirectory: () =>
        String(p) === '/repo/apps/web/src/components/chat' ||
        String(p) === '/repo/apps/web/src/components/chat/components',
    });
    readdirSyncImpl = (p) => {
      const s = String(p);
      if (s === '/repo/apps/web/src/components/chat') {
        return [fakeDirent('README.md', 'file'), fakeDirent('components', 'dir')];
      }
      if (s === '/repo/apps/web/src/components/chat/components') {
        return [fakeDirent('ChatDock.tsx', 'file'), fakeDirent('ChatPanel.tsx', 'file')];
      }
      return [];
    };

    await runBugEnhance({
      ...BASE_INPUT,
      body: 'The bug seems to be in apps/web/src/components/chat/ChatWidget.tsx',
    });

    const spec = mockRunFn.mock.calls.at(-1)?.[0] as { appendSystemPrompt?: string };
    expect(spec.appendSystemPrompt).toContain(
      'Missing issue-mentioned path: `apps/web/src/components/chat/ChatWidget.tsx`',
    );
    expect(spec.appendSystemPrompt).toContain(
      '`apps/web/src/components/chat/components/ChatPanel.tsx`',
    );
    expect(spec.appendSystemPrompt).toContain(
      'Use existing nearby files as grounding targets; do not read missing paths.',
    );
  });
});

describe('runBugEnhance — repo-intel grounding contract', () => {
  beforeEach(() => {
    mockRunFn.mockClear();
    vi.mocked(eventStore.appendEvent).mockClear();
    existsSyncImpl = (p) => {
      const s = String(p);
      return s === '/repo' || s === '/repo/apps/web/src/components/header/CaptureHeader.tsx';
    };
    readdirSyncImpl = () => [];
    statSyncImpl = () => ({ isDirectory: () => false });
  });

  it('accepts a Claude run that used the prefixed repo-intel tool and produced grounded content', async () => {
    vi.mocked(resolveSkillRuntimeForProject).mockReturnValue(makeResolvedRuntime('claude'));
    const hints = makeHints(['apps/web/src/components/header/CaptureHeader.tsx']);
    mockRunFn.mockResolvedValue(
      makeAgentResult(hints, {
        enhancedContent:
          '**Repro steps**\n1. Open the header.\n\n**Location**\napps/web/src/components/header/CaptureHeader.tsx',
        events: [makeToolEvent('mcp__factory-tools__repo_intel.query')],
      }),
    );

    const result = await runBugEnhance({
      ...BASE_INPUT,
      title: 'Capture key in the header should open with Apple J',
    });

    expect(result.markdown).toContain('CaptureHeader.tsx');
    expect(result.groundedHints?.candidateFiles).toHaveLength(1);
    expect(mockRunFn.mock.calls[0][0]).toMatchObject({ skill: 'bug-enhance' });
    expect(vi.mocked(eventStore.appendEvent).mock.calls).not.toContainEqual([
      expect.objectContaining({ kind: 'agent.bug-enhance-empty' }),
    ]);
  });

  it('accepts a Codex run that used the bare repo-intel tool and produced grounded content', async () => {
    vi.mocked(resolveSkillRuntimeForProject).mockReturnValue(makeResolvedRuntime('codex'));
    const hints = makeHints(['apps/web/src/components/header/CaptureHeader.tsx']);
    mockRunFn.mockResolvedValue(
      makeAgentResult(hints, {
        enhancedContent:
          '**Repro steps**\n1. Open the header.\n\n**Location**\napps/web/src/components/header/CaptureHeader.tsx',
        events: [makeToolEvent('repo_intel.query')],
      }),
    );

    const result = await runBugEnhance({
      ...BASE_INPUT,
      title: 'Capture key in the header should open with Apple J',
    });

    expect(result.markdown).toContain('CaptureHeader.tsx');
    expect(result.groundedHints?.candidateFiles).toEqual([
      expect.objectContaining({ path: 'apps/web/src/components/header/CaptureHeader.tsx' }),
    ]);
    expect(mockRunFn.mock.calls[0][0]).toMatchObject({ skill: 'bug-enhance' });
  });

  it('emits structured empty telemetry when no tool call was made and no output was produced', async () => {
    mockRunFn.mockResolvedValue(
      makeAgentResult(undefined, {
        enhancedContent: '',
        category: 'unknown',
        events: [],
      }),
    );

    const result = await runBugEnhance(BASE_INPUT);

    expect(result).toEqual({ markdown: null, groundedHints: null });
    expect(eventStore.appendEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'agent.bug-enhance-empty',
        payload: expect.objectContaining({
          reasons: expect.arrayContaining([
            'no-tool-call-made',
            'category-unknown',
            'empty-enhanced-content',
            'no-grounded-hints',
          ]),
          toolCallCount: 0,
          repoIntelCallCount: 0,
        }),
      }),
    );
  });

  it('emits structured empty telemetry when the repo-intel tool call was blocked', async () => {
    mockRunFn.mockResolvedValue(
      makeAgentResult(undefined, {
        enhancedContent: '',
        events: [
          makeToolEvent('repo_intel.query', {
            blocked: true,
            status: 'failed',
            block_reason: 'tool not in allowlist: repo_intel.query',
          }),
        ],
      }),
    );

    await runBugEnhance(BASE_INPUT);

    expect(eventStore.appendEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'agent.bug-enhance-empty',
        payload: expect.objectContaining({
          reasons: expect.arrayContaining([
            'tool-call-blocked',
            'empty-enhanced-content',
            'no-grounded-hints',
          ]),
          blockedToolCallCount: 1,
          blockedToolNames: ['repo_intel.query'],
        }),
      }),
    );
  });

  it('emits structured empty telemetry when output validation fails', async () => {
    mockRunFn.mockResolvedValue({
      output: {
        enhancedContent: '',
        category: 'ui-web',
        decisionSummaries: [],
      },
      decisionSummaries: [],
      events: [makeToolEvent('repo_intel.query')],
    });

    const result = await runBugEnhance(BASE_INPUT);

    expect(result).toEqual({ markdown: null, groundedHints: null });
    expect(eventStore.appendEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'agent.bug-enhance-empty',
        payload: expect.objectContaining({
          reasons: ['output-validation-failed'],
          repoIntelCallCount: 1,
        }),
      }),
    );
  });
});
