import type { AgentEvent } from '../event-stream/store.js';
import type { FeatureEnhanceOutput } from '@goose-hub/skills/feature-enhance/schema.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ResolvedSkillRuntime } from './skill-runtime-resolver.js';

const mockAppendEvent = vi.fn();
const mockReplay = vi.fn();
const mockRunFn = vi.fn();

vi.mock('../event-stream/store.js', () => ({
  eventStore: {
    appendEvent: (...args: unknown[]) => mockAppendEvent(...args),
    replay: (...args: unknown[]) => mockReplay(...args),
  },
}));

vi.mock('../projects/loader.js', () => ({
  getProjectBySlug: vi.fn().mockResolvedValue(null),
}));

vi.mock('./skill-runtime-resolver.js', () => ({
  resolveSkillRuntimeForProject: vi.fn().mockReturnValue({
    budgets: { maxTurns: 5, maxBudgetUsd: 0.2, timeoutMs: 30_000 },
    modelOverride: 'claude-3-5-haiku-latest',
    tier: 'haiku',
    provider: 'claude',
    source: 'skill-default',
    selectionReason: 'test',
    runtimeTrace: {
      tier: { value: 'haiku', source: 'skill-default', reason: 'test' },
      provider: { value: 'claude', source: 'skill-default', reason: 'test' },
    },
    resolvedPrimary: { tier: 'haiku', provider: 'claude', modelId: 'claude-3-5-haiku-latest' },
    resolvedFallback: null,
    resolvedAdvisor: null,
  }),
}));

vi.mock('./select-persona.js', () => ({
  selectPersona: vi.fn().mockReturnValue({ personaId: 'goose-hub-self/triager/0' }),
}));

vi.mock('./select-runtime.js', () => ({
  selectRuntime: vi.fn().mockReturnValue({ run: mockRunFn }),
}));

vi.mock('./read-prompt.js', () => ({
  readPromptWithContext: vi.fn().mockReturnValue('# mock feature-enhance prompt'),
}));

vi.mock('./schema-bridge.js', () => ({
  toJsonSchema: vi.fn().mockReturnValue({ type: 'object', title: 'FeatureEnhanceOutput' }),
}));

vi.mock('../logger.js', () => ({
  logger: { warn: vi.fn(), error: vi.fn() },
}));

const { runFeatureEnhance } = await import('./feature-enhance-runner.js');
const { resolveSkillRuntimeForProject } = await import('./skill-runtime-resolver.js');

function makeToolEvent(toolName: string, overrides: Record<string, unknown> = {}): AgentEvent {
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
    runId: 'grounding-run:feature-enhance',
    personaId: null,
    createdAt: '2026-06-05T00:00:00.000Z',
  };
}

function makeOutput(overrides: Partial<FeatureEnhanceOutput> = {}): FeatureEnhanceOutput {
  return {
    candidateFiles: [
      {
        path: 'slices/feature-grounding/workflow.ts',
        confidence: 'high',
        source: 'tool-verified',
        reason: 'Existing feature grounding workflow.',
      },
    ],
    existingSurfaces: ['slices/feature-grounding/workflow.ts'],
    similarPatterns: ['Feature grounding emits grounding events.'],
    testSurfaces: ['slices/feature-grounding/slice.test.ts'],
    acceptanceHints: ['Grounding emits a complete event before implementation.'],
    openQuestions: [],
    confidence: 'high',
    escalationSignals: [],
    ...overrides,
  };
}

function makeInput() {
  return {
    projectId: 'goose-hub-self',
    workItemId: 'github:owner/repo#42',
    enhanceRunId: 'grounding-run:feature-enhance',
    parentRunId: 'grounding-run',
    workspaceDir: '/repo',
    context: {
      workItem: {
        number: 42,
        title: 'Add feature grounding diagnostics',
        body: 'Make feature-enhance failures visible.',
      },
      projectContext: {
        projectId: 'goose-hub-self',
        targetRepo: '/repo',
        defaultBranch: 'main',
      },
    },
  };
}

function makeResolvedRuntime(provider: 'claude' | 'codex'): ResolvedSkillRuntime {
  const tier = provider === 'codex' ? 'sonnet' : 'haiku';
  const modelOverride = provider === 'codex' ? 'gpt-5-codex' : 'claude-3-5-haiku-latest';
  return {
    budgets: { maxTurns: 5, maxBudgetUsd: 0.2, timeoutMs: 30_000 },
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

describe('runFeatureEnhance', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockReplay.mockReturnValue([]);
    vi.mocked(resolveSkillRuntimeForProject).mockReturnValue(makeResolvedRuntime('claude'));
  });

  it('returns ok:true for valid grounded output', async () => {
    mockRunFn.mockResolvedValue({
      output: makeOutput(),
      decisionSummaries: [],
      events: [makeToolEvent('mcp__factory-tools__repo_intel.query')],
    });

    const result = await runFeatureEnhance(makeInput());

    expect(result).toMatchObject({
      ok: true,
      enhanceRunId: 'grounding-run:feature-enhance',
      output: expect.objectContaining({ confidence: 'high' }),
    });
    expect(mockAppendEvent).not.toHaveBeenCalled();
    expect(mockRunFn).toHaveBeenCalledWith(expect.objectContaining({ toolBundles: ['read'] }));
  });

  it('emits agent.feature-enhance-empty when output validation fails', async () => {
    mockRunFn.mockResolvedValue({
      output: { confidence: 'maybe' },
      decisionSummaries: [],
      events: [makeToolEvent('repo_intel.query')],
    });

    const result = await runFeatureEnhance(makeInput());

    expect(result).toMatchObject({ ok: false, reason: 'output-validation-failed' });
    expect(mockAppendEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'agent.feature-enhance-empty',
        payload: expect.objectContaining({
          parentRunId: 'grounding-run',
          enhanceRunId: 'grounding-run:feature-enhance',
          reasons: ['output-validation-failed'],
          repoIntelCallCount: 1,
          validationIssues: expect.any(Array),
          outputPreview: expect.any(String),
        }),
      }),
    );
  });

  it('captures blocked tool calls as blocked tool names', async () => {
    mockRunFn.mockResolvedValue({
      output: makeOutput(),
      decisionSummaries: [],
      events: [
        makeToolEvent('mcp__factory-tools__search_text', {
          blocked: true,
          status: 'failed',
        }),
      ],
    });

    const result = await runFeatureEnhance(makeInput());

    expect(result).toMatchObject({ ok: false, reason: 'tool-call-blocked' });
    expect(mockAppendEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          blockedToolCallCount: 1,
          blockedToolNames: ['search_text'],
        }),
      }),
    );
  });

  it('emits empty/no-grounding telemetry for valid low-confidence empty output', async () => {
    mockRunFn.mockResolvedValue({
      output: makeOutput({
        candidateFiles: [],
        existingSurfaces: [],
        similarPatterns: [],
        testSurfaces: [],
        acceptanceHints: [],
        openQuestions: ['No matching repo surface found.'],
        confidence: 'low',
        escalationSignals: ['needs product clarification'],
      }),
      decisionSummaries: [],
      events: [makeToolEvent('repo_intel.query')],
    });

    const result = await runFeatureEnhance(makeInput());

    expect(result).toMatchObject({ ok: false, reason: 'no-grounded-output' });
    expect(mockAppendEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          reasons: ['no-grounded-output'],
          toolCallCount: 1,
          repoIntelCallCount: 1,
        }),
      }),
    );
  });

  it('replays events and emits telemetry for runtime max-turn failures', async () => {
    mockRunFn.mockRejectedValue(new Error('tool-call budget exceeded: 6 > 5'));
    mockReplay.mockReturnValue([
      makeToolEvent('repo_intel.query'),
      makeToolEvent('mcp__factory-tools__read_file'),
    ]);

    const result = await runFeatureEnhance(makeInput());

    expect(mockReplay).toHaveBeenCalledWith({ runId: 'grounding-run:feature-enhance' });
    expect(result).toMatchObject({ ok: false, reason: 'runtime-max-turn-failed' });
    expect(mockAppendEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          reasons: ['runtime-max-turn-failed'],
          toolCallCount: 2,
          repoIntelCallCount: 1,
          error: expect.stringContaining('tool-call budget exceeded'),
        }),
      }),
    );
  });

  it('counts both Claude-prefixed and Codex repo-intel calls', async () => {
    vi.mocked(resolveSkillRuntimeForProject).mockReturnValue(makeResolvedRuntime('codex'));
    mockRunFn.mockResolvedValue({
      output: makeOutput({
        candidateFiles: [],
        existingSurfaces: [],
        similarPatterns: [],
        testSurfaces: [],
        acceptanceHints: [],
        confidence: 'low',
      }),
      decisionSummaries: [],
      events: [
        makeToolEvent('mcp__factory-tools__repo_intel.query'),
        makeToolEvent('repo_intel.query'),
      ],
    });

    await runFeatureEnhance(makeInput());

    expect(mockAppendEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          repoIntelCallCount: 2,
          runtime: 'codex-cli',
          modelId: 'gpt-5-codex',
        }),
      }),
    );
  });

  it('rejects candidate files without tool-verified evidence', async () => {
    mockRunFn.mockResolvedValue({
      output: makeOutput({
        candidateFiles: [
          {
            path: 'apps/web/src/components/detail/IssueDetailPage.tsx',
            confidence: 'medium',
            source: 'inferred',
            reason: 'Looks related from product wording.',
          },
        ],
      }),
      decisionSummaries: [],
      events: [makeToolEvent('repo_intel.query')],
    });

    const result = await runFeatureEnhance(makeInput());

    expect(result).toMatchObject({
      ok: false,
      reason: 'candidate-files-without-tool-verified-evidence',
    });
    expect(mockAppendEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          reasons: ['candidate-files-without-tool-verified-evidence'],
        }),
      }),
    );
  });
});
