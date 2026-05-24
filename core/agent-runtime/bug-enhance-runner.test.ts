import type { GroundedHints } from '@goose-hub/skills/bug-enhance/schema.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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
vi.mock('node:fs', () => ({
  existsSync: (p: unknown) => existsSyncImpl(p),
}));

const { runBugEnhance } = await import('./bug-enhance-runner.js');
const { eventStore } = await import('../event-stream/store.js');

function makeHints(paths: string[]): GroundedHints {
  return {
    candidateFiles: paths.map((p) => ({ path: p, confidence: 'high' as const })),
    candidateComponents: [],
    candidateRoutes: [],
  };
}

function makeAgentResult(hints: GroundedHints | undefined) {
  return {
    output: {
      enhancedContent: 'Enhanced bug content',
      category: 'ui-web',
      groundedHints: hints,
      decisionSummaries: [{ kind: 'READ', summary: 'done' }],
    },
    decisionSummaries: [],
    events: [],
  };
}

const BASE_INPUT = {
  projectId: 'goose-hub-self',
  workItemId: 'github:owner/repo#42',
  title: 'Bug title',
  body: 'Bug body',
  workspaceDir: '/repo',
};

describe('runBugEnhance — path-existence pruning', () => {
  beforeEach(() => {
    mockRunFn.mockResolvedValue(makeAgentResult(makeHints(['real.ts', 'fake.ts'])));
    vi.mocked(eventStore.appendEvent).mockClear();
    // Default: workspace exists; 'real.ts' exists; 'fake.ts' does not
    existsSyncImpl = (p) => {
      const s = String(p);
      if (s === '/repo') return true;
      if (s === '/repo/real.ts') return true;
      return false;
    };
  });

  it('keeps paths that exist and drops paths that do not', async () => {
    const result = await runBugEnhance(BASE_INPUT);
    expect(result.groundedHints?.candidateFiles).toHaveLength(1);
    expect(result.groundedHints?.candidateFiles[0].path).toBe('real.ts');
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
});
