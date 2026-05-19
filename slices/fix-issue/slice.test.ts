import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { AgentResult, AgentRuntime } from '@goose-hub/core/agent-runtime/interface.js';
import type { StateSource, WorkItem } from '@goose-hub/core/state-source/interface.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let mockProjectSkillSettings = new Map<string, Record<string, unknown>>();
vi.mock('@goose-hub/core/db/repositories/project-settings.js', () => ({
  getEvidencePostEnabled: vi.fn((_projectId: string, configDefault = true) => configDefault),
  readProjectSettings: vi.fn().mockReturnValue(null),
  readProjectSkillSettings: vi.fn(() => mockProjectSkillSettings),
}));
vi.mock('@goose-hub/core/event-stream/store.js', () => ({
  eventStore: {
    appendEvent: vi.fn().mockReturnValue({ id: 1 }),
    replay: vi.fn().mockReturnValue([]),
  },
}));
vi.mock('@goose-hub/core/agent-runtime/select-persona.js', () => ({
  selectPersona: vi
    .fn()
    .mockReturnValue({ personaId: 'proj/developer/0', codename: 'Grey Honker' }),
}));
const mockAccumulatePersonaStats = vi.fn();
vi.mock('@goose-hub/core/persona/accumulate.js', () => ({
  accumulatePersonaStats: (...args: unknown[]) => mockAccumulatePersonaStats(...args),
}));
vi.mock('@goose-hub/core/agent-runtime/schema-bridge.js', () => ({
  toJsonSchema: vi.fn().mockReturnValue({}),
}));
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return { ...actual, readFileSync: vi.fn().mockReturnValue('# mock skill prompt') };
});
const { mockLookupWorkItemSymbols, mockSymbolHintsToKeyFiles } = vi.hoisted(() => ({
  mockLookupWorkItemSymbols: vi.fn().mockReturnValue([]),
  mockSymbolHintsToKeyFiles: vi.fn().mockReturnValue([]),
}));
vi.mock('@goose-hub/core/symbol-index/lookup.js', () => ({
  lookupWorkItemSymbols: (...args: unknown[]) => mockLookupWorkItemSymbols(...args),
  symbolHintsToKeyFiles: (...args: unknown[]) => mockSymbolHintsToKeyFiles(...args),
}));

// Mock default dep implementations so the ?? fallback branches (lines 68-73) are reachable
const mockClaudeCliRun = vi.fn();
vi.mock('@goose-hub/core/agent-runtime/claude-cli.js', () => ({
  ClaudeCliRuntime: vi.fn().mockImplementation(() => ({ run: mockClaudeCliRun })),
}));
const mockCodexCliRun = vi.fn();
vi.mock('@goose-hub/core/agent-runtime/codex-cli.js', () => ({
  CodexCliRuntime: vi.fn().mockImplementation(() => ({ run: mockCodexCliRun })),
}));
let mockProjectConfig: Record<string, unknown> | null = {
  agentConfig: { runtime: 'auto' },
  budgets: undefined,
  stack: {
    testCommand: 'pnpm test',
    lintCommand: 'pnpm lint',
    typecheckCommand: 'pnpm typecheck',
  },
};
vi.mock('@goose-hub/core/projects/loader.js', () => ({
  getProjectBySlug: vi.fn(() => mockProjectConfig),
}));
const mockOpenPR = vi
  .fn()
  .mockResolvedValue({ prNumber: 1, prUrl: 'u', branch: 'b', base: 'main' });
vi.mock('@goose-hub/core/connectors/github/open-pr.js', () => ({
  openPR: (...args: unknown[]) => mockOpenPR(...args),
}));
const mockAdviseOnPlan = vi.fn();
vi.mock('@goose-hub/core/agent-runtime/advisor.js', () => ({
  adviseOnPlan: (...args: unknown[]) => mockAdviseOnPlan(...args),
}));
const mockCreateWorktree = vi.fn().mockReturnValue('/work/wt');
const mockCleanupWorktree = vi.fn();
const mockPrewarmWorktree = vi.fn();
const mockResolveWorkflowBase = vi.fn().mockReturnValue({
  branch: 'main',
  ref: 'origin/main',
  source: 'configured-default',
});
vi.mock('@goose-hub/core/workspaces/worktree.js', () => ({
  createWorktree: (...args: unknown[]) => mockCreateWorktree(...args),
  cleanupWorktree: (...args: unknown[]) => mockCleanupWorktree(...args),
  prewarmWorktree: (...args: unknown[]) => mockPrewarmWorktree(...args),
  resolveWorkflowBase: (...args: unknown[]) => mockResolveWorkflowBase(...args),
}));
vi.mock('@goose-hub/core/workspaces/orchestrator-git.js', () => ({
  orchestratorCommitAll: vi.fn().mockReturnValue('fake-sha'),
}));

import { eventStore } from '@goose-hub/core/event-stream/store.js';
import { GIT_ENV } from '@goose-hub/core/workspaces/git-env.js';

function resetEventStoreMocks(): void {
  vi.mocked(eventStore.replay).mockReturnValue([]);
  mockLookupWorkItemSymbols.mockReturnValue([]);
  mockSymbolHintsToKeyFiles.mockReturnValue([]);
}

function makeInvestigationEvent(item: WorkItem, overrides: Record<string, unknown> = {}) {
  return {
    id: 99,
    projectId: 'proj',
    workItemId: item.id,
    kind: 'agent.investigation-complete',
    payload: {
      investigate: {
        findings: 'Failure handling is in triage-batch and fallback retry code.',
        keyFiles: [
          {
            path: 'apps/server/src/domains/workflows/triage-batch.ts',
            reason: 'owns failed triage state transitions',
          },
          {
            path: 'core/agent-runtime/fallback.ts',
            reason: 'owns maxAttempts handling',
          },
        ],
        openQuestions: ['Should repo-match fail immediately or after two attempts?'],
        ...overrides,
      },
      investigationRunId: 'investigation-run-1',
    },
    createdAt: new Date().toISOString(),
    runId: 'investigation-run-1',
  } as never;
}

function makeWorkItem(overrides: Partial<WorkItem> = {}): WorkItem {
  return {
    id: 'github:owner/repo#42',
    externalId: '42',
    repoRef: 'owner/repo',
    title: 'Add capitalize helper',
    body: 'Add capitalize(s) to core/utils/strings.ts',
    type: 'chore',
    priority: 'medium',
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

function makeStateSource(): StateSource {
  return {
    projectId: 'proj',
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
  };
}

function makeImplementOutput(overrides: Record<string, unknown> = {}) {
  return {
    plan: '1. Tests; 2. Implementation; 3. Lint.',
    filesWritten: [
      { path: 'core/utils/strings.ts', reason: 'new helper' },
      { path: 'core/utils/strings.test.ts', reason: 'tests' },
    ],
    testsWritten: [{ path: 'core/utils/strings.test.ts', cases: 3 }],
    testsRun: {
      command: 'pnpm test ',
      paths: ['core/utils/strings.test.ts'],
    },
    prUrl: 'https://github.com/owner/repo/issues/42',
    evidenceSpecPath: null as string | null,
    confidence: 'high' as const,
    decisionSummaries: [
      { kind: 'PLAN', summary: 'Add helper at core/utils/strings.ts' },
      { kind: 'GREEN', summary: 'All 3 tests pass' },
    ],
    ...overrides,
  };
}

function makeTempWorktree(paths: string[]): string {
  const worktreePath = mkdtempSync(join(tmpdir(), 'goose-hub-fix-issue-'));
  for (const path of paths) {
    const absPath = join(worktreePath, path);
    mkdirSync(dirname(absPath), { recursive: true });
    writeFileSync(absPath, '');
  }
  return worktreePath;
}

function makeGitWorktree(paths: string[] = []): string {
  const worktreePath = makeTempWorktree(paths);
  execFileSync('git', ['init', '-q'], { cwd: worktreePath, env: GIT_ENV });
  execFileSync('git', ['config', 'user.email', 'factory@example.test'], {
    cwd: worktreePath,
    env: GIT_ENV,
  });
  execFileSync('git', ['config', 'user.name', 'Factory Test'], {
    cwd: worktreePath,
    env: GIT_ENV,
  });
  return worktreePath;
}

function resetRuntimeRoutingMocks(): void {
  mockProjectSkillSettings = new Map();
  mockProjectConfig = {
    agentConfig: { runtime: 'auto' },
    budgets: undefined,
    stack: {
      testCommand: 'pnpm test',
      lintCommand: 'pnpm lint',
      typecheckCommand: 'pnpm typecheck',
    },
  };
}

describe('runFixIssueWorkflow — default deps (lines 68-73 ?? fallbacks)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetEventStoreMocks();
    mockAccumulatePersonaStats.mockClear();
    resetRuntimeRoutingMocks();
    mockProjectSkillSettings = new Map();
    process.env.GITHUB_TOKEN = 'ghp_test';
    mockClaudeCliRun.mockResolvedValueOnce({
      output: makeImplementOutput(),
      decisionSummaries: [],
      events: [],
    } satisfies AgentResult);
  });

  afterEach(() => {
    process.env.GITHUB_TOKEN = undefined;
  });

  it('uses default implementations when no deps provided (covers ?? fallback branches)', async () => {
    const item = makeWorkItem({ priority: 'medium' });
    const source = makeStateSource();

    const { runFixIssueWorkflow } = await import('./workflow.js');
    // Call with no deps — exercises lines 68-73 ?? fallbacks for all default values
    await runFixIssueWorkflow(item, source, 'proj', '/repo');

    // ClaudeCliRuntime was used (default runtime dep)
    expect(mockClaudeCliRun).toHaveBeenCalledTimes(1);
    // createWorktree was called (default worktree dep)
    expect(mockCreateWorktree).toHaveBeenCalledWith('/repo', expect.any(String), 'origin/main');
    // openPR was called (default openPR dep)
    expect(mockOpenPR).toHaveBeenCalled();
    // worktree persists until merge — NOT cleaned up after PR open
    expect(mockCleanupWorktree).not.toHaveBeenCalled();
  });
});

describe('runFixIssueWorkflow — provider-aware runtime dispatch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetEventStoreMocks();
    mockAccumulatePersonaStats.mockClear();
    resetRuntimeRoutingMocks();
    process.env.GITHUB_TOKEN = 'ghp_test';
    mockCodexCliRun.mockResolvedValue({
      output: makeImplementOutput(),
      decisionSummaries: [],
      events: [],
    } satisfies AgentResult);
  });

  afterEach(() => {
    process.env.GITHUB_TOKEN = undefined;
  });

  it('uses CodexCliRuntime and a gpt model when per-skill provider is codex', async () => {
    mockProjectSkillSettings = new Map([
      [
        'implement',
        {
          projectId: 'proj',
          skillName: 'implement',
          modelTier: 'haiku',
          modelProvider: 'codex',
        },
      ],
    ]);
    const item = makeWorkItem({ priority: 'medium', type: 'chore' });
    const source = makeStateSource();

    const { runFixIssueWorkflow } = await import('./workflow.js');
    await runFixIssueWorkflow(item, source, 'proj', '/repo', {
      openPRImpl: vi.fn().mockResolvedValue({
        prNumber: 100,
        prUrl: 'https://github.com/owner/repo/pull/100',
        branch: 'factory/abc',
        base: 'main',
      }),
      adviseOnPlanImpl: vi.fn(),
      createWorktreeImpl: vi.fn().mockReturnValue('/work/wt'),
      cleanupWorktreeImpl: vi.fn(),
      resolveWorktreeHeadShaImpl: vi
        .fn()
        .mockReturnValue('abc1234567890abcdef1234567890abcdef1234'),
    });

    expect(mockCodexCliRun).toHaveBeenCalledTimes(1);
    expect(mockClaudeCliRun).not.toHaveBeenCalled();
    const spec = mockCodexCliRun.mock.calls[0][0] as { modelOverride?: string };
    expect(spec.modelOverride).toBe('gpt-5.4-mini');
  });

  it("agentConfig.runtime: 'codex-cli' coerces tier defaults to Codex models", async () => {
    mockProjectConfig = {
      agentConfig: { runtime: 'codex-cli' },
      budgets: undefined,
      stack: { testCommand: 'pnpm test' },
    };
    const item = makeWorkItem({ priority: 'medium', type: 'feature', body: 'Small feature' });
    const source = makeStateSource();

    const { runFixIssueWorkflow } = await import('./workflow.js');
    await runFixIssueWorkflow(item, source, 'proj', '/repo', {
      openPRImpl: vi.fn().mockResolvedValue({
        prNumber: 100,
        prUrl: 'https://github.com/owner/repo/pull/100',
        branch: 'factory/abc',
        base: 'main',
      }),
      adviseOnPlanImpl: vi.fn(),
      createWorktreeImpl: vi.fn().mockReturnValue('/work/wt'),
      cleanupWorktreeImpl: vi.fn(),
      resolveWorktreeHeadShaImpl: vi
        .fn()
        .mockReturnValue('abc1234567890abcdef1234567890abcdef1234'),
    });

    expect(mockCodexCliRun).toHaveBeenCalledTimes(1);
    const spec = mockCodexCliRun.mock.calls[0][0] as { modelOverride?: string };
    expect(spec.modelOverride).toBe('gpt-5.4-mini');
  });

  it('keeps an injected runtime instead of replacing it with provider dispatch', async () => {
    const runtime: AgentRuntime = {
      run: vi.fn().mockResolvedValueOnce({
        output: makeImplementOutput(),
        decisionSummaries: [],
        events: [],
      } satisfies AgentResult),
    };

    const { runFixIssueWorkflow } = await import('./workflow.js');
    await runFixIssueWorkflow(
      makeWorkItem({ priority: 'medium' }),
      makeStateSource(),
      'proj',
      '/repo',
      {
        runtime,
        openPRImpl: vi.fn().mockResolvedValue({
          prNumber: 100,
          prUrl: 'https://github.com/owner/repo/pull/100',
          branch: 'factory/abc',
          base: 'main',
        }),
        adviseOnPlanImpl: vi.fn(),
        createWorktreeImpl: vi.fn().mockReturnValue('/work/wt'),
        cleanupWorktreeImpl: vi.fn(),
        resolveWorktreeHeadShaImpl: vi
          .fn()
          .mockReturnValue('abc1234567890abcdef1234567890abcdef1234'),
      },
    );

    expect(runtime.run).toHaveBeenCalledTimes(1);
    expect(mockCodexCliRun).not.toHaveBeenCalled();
    expect(mockClaudeCliRun).not.toHaveBeenCalled();
  });

  it('maps per-skill DB tier/provider to the concrete Codex model', async () => {
    mockProjectSkillSettings = new Map([
      [
        'implement',
        {
          projectId: 'proj',
          skillName: 'implement',
          modelTier: 'haiku',
          modelProvider: 'codex',
        },
      ],
    ]);

    const { runFixIssueWorkflow } = await import('./workflow.js');
    await runFixIssueWorkflow(
      makeWorkItem({ priority: 'medium', type: 'bug', body: 'Fix the crash' }),
      makeStateSource(),
      'proj',
      '/repo',
      {
        openPRImpl: vi.fn().mockResolvedValue({
          prNumber: 100,
          prUrl: 'https://github.com/owner/repo/pull/100',
          branch: 'factory/abc',
          base: 'main',
        }),
        adviseOnPlanImpl: vi.fn(),
        createWorktreeImpl: vi.fn().mockReturnValue('/work/wt'),
        cleanupWorktreeImpl: vi.fn(),
        resolveWorktreeHeadShaImpl: vi
          .fn()
          .mockReturnValue('abc1234567890abcdef1234567890abcdef1234'),
      },
    );

    const spec = mockCodexCliRun.mock.calls[0][0] as { modelOverride?: string };
    expect(spec.modelOverride).toBe('gpt-5.4-mini');
  });
});

describe('runFixIssueWorkflow (#183)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetEventStoreMocks();
    mockAccumulatePersonaStats.mockClear();
    resetRuntimeRoutingMocks();
    process.env.GITHUB_TOKEN = 'ghp_test';
  });

  afterEach(() => {
    process.env.GITHUB_TOKEN = undefined;
  });

  it('happy path (priority:medium, no advisor): worktree → in-progress → implement → PR → needs-qa', async () => {
    const item = makeWorkItem({ priority: 'medium' });
    const source = makeStateSource();

    const runtime: AgentRuntime = {
      run: vi.fn().mockResolvedValueOnce({
        output: makeImplementOutput(),
        decisionSummaries: [],
        events: [],
      } satisfies AgentResult),
    };

    const openPRImpl = vi.fn().mockResolvedValue({
      prNumber: 100,
      prUrl: 'https://github.com/owner/repo/pull/100',
      branch: 'factory/abc',
      base: 'main',
    });
    const adviseOnPlanImpl = vi.fn();
    const createWorktreeImpl = vi.fn().mockReturnValue('/work/wt');
    const cleanupWorktreeImpl = vi.fn();
    const resolveWorktreeHeadShaImpl = vi
      .fn()
      .mockReturnValue('abc1234567890abcdef1234567890abcdef1234');

    const { runFixIssueWorkflow } = await import('./workflow.js');
    await runFixIssueWorkflow(item, source, 'proj', '/repo', {
      runtime,
      openPRImpl,
      adviseOnPlanImpl,
      createWorktreeImpl,
      cleanupWorktreeImpl,
      resolveWorktreeHeadShaImpl,
    });

    expect(createWorktreeImpl).toHaveBeenCalledWith('/repo', expect.any(String), 'origin/main');
    expect(source.transitionState).toHaveBeenNthCalledWith(
      1,
      '42',
      'factory:dev-ready',
      'factory:in-progress',
    );
    expect(adviseOnPlanImpl).not.toHaveBeenCalled();
    expect(runtime.run).toHaveBeenCalledTimes(1); // implement only — no advisor, no evidence (null specPath)
    expect(openPRImpl).toHaveBeenCalled();
    const prCall = vi.mocked(openPRImpl).mock.calls[0][0];
    expect(prCall.repo).toBe('owner/repo');
    expect(prCall.issueNumber).toBe(42);
    expect(prCall.body).toContain('Closes #42');
    expect(prCall.body).not.toMatch(/decision|reasoning|chain[- ]of[- ]thought/i);
    expect(source.transitionState).toHaveBeenLastCalledWith(
      '42',
      'factory:in-progress',
      'factory:needs-qa',
    );
    // worktree persists until merge — NOT cleaned up after PR open
    expect(cleanupWorktreeImpl).not.toHaveBeenCalled();
    // pr.opened event recorded with worktreePath and devRunId for QA and merge cleanup
    const opened = vi
      .mocked(eventStore.appendEvent)
      .mock.calls.find(([e]) => e.kind === 'pr.opened');
    expect(opened).toBeDefined();
    const openedPayload = opened?.[0].payload as Record<string, unknown>;
    expect(openedPayload).toHaveProperty('worktreePath');
    expect(openedPayload).toHaveProperty('devRunId');
    expect(openedPayload).toHaveProperty('baseBranch', 'main');
    expect(mockAccumulatePersonaStats).toHaveBeenCalledWith({
      personaName: 'proj/developer/0',
      role: 'developer',
      outcome: 'success',
    });
  });

  it('injects latest investigation findings into implement context and emits an audit event', async () => {
    const item = makeWorkItem({ priority: 'medium', type: 'bug' });
    const source = makeStateSource();
    vi.mocked(eventStore.replay).mockReturnValue([makeInvestigationEvent(item)]);

    const runtime: AgentRuntime = {
      run: vi.fn().mockResolvedValueOnce({
        output: makeImplementOutput({
          filesWritten: [
            {
              path: 'apps/server/src/domains/workflows/triage-batch.ts',
              reason: 'stop failed triage loops',
            },
            {
              path: 'apps/server/src/domains/workflows/triage-batch.test.ts',
              reason: 'regression coverage',
            },
          ],
          testsWritten: [
            { path: 'apps/server/src/domains/workflows/triage-batch.test.ts', cases: 2 },
          ],
          testsRun: {
            command: 'pnpm test --reporter=json',
            paths: ['apps/server/src/domains/workflows/triage-batch.test.ts'],
          },
        }),
        decisionSummaries: [],
        events: [],
      } satisfies AgentResult),
    };

    const { runFixIssueWorkflow } = await import('./workflow.js');
    await runFixIssueWorkflow(item, source, 'proj', '/repo', {
      runtime,
      openPRImpl: vi.fn().mockResolvedValue({
        prNumber: 100,
        prUrl: 'https://github.com/owner/repo/pull/100',
        branch: 'factory/abc',
        base: 'main',
      }),
      adviseOnPlanImpl: vi.fn(),
      createWorktreeImpl: vi.fn().mockReturnValue('/work/wt'),
      cleanupWorktreeImpl: vi.fn(),
      resolveWorktreeHeadShaImpl: vi
        .fn()
        .mockReturnValue('abc1234567890abcdef1234567890abcdef1234'),
    });

    const implementSpec = vi.mocked(runtime.run).mock.calls[0][0] as {
      context: { investigation?: { findings?: string; keyFiles?: Array<{ path: string }> } };
      contextAllowlist: string[];
    };
    expect(implementSpec.context.investigation?.findings).toContain('triage-batch');
    expect(implementSpec.context.investigation?.keyFiles?.map((f) => f.path)).toContain(
      'apps/server/src/domains/workflows/triage-batch.ts',
    );
    expect(implementSpec.contextAllowlist).toContain('investigation');

    const injected = vi
      .mocked(eventStore.appendEvent)
      .mock.calls.find(([e]) => e.kind === 'agent.investigation-context-injected');
    expect(injected).toBeDefined();
    expect(injected?.[0].payload).toMatchObject({
      skill: 'implement',
      investigationRunId: 'investigation-run-1',
      keyFileCount: 2,
      openQuestionCount: 1,
    });
  });

  it('adds curated symbol key files to implement context without raw symbol payloads', async () => {
    const item = makeWorkItem({ priority: 'medium', type: 'bug', title: 'Fix dispatchWave' });
    const source = makeStateSource();
    vi.mocked(eventStore.replay).mockReturnValue([makeInvestigationEvent(item)]);
    const rawHints = [
      {
        name: 'dispatchWave',
        definedIn: 'core/agent-runtime/swarm.ts',
        line: 10,
        kind: 'function',
        callers: ['slices/investigate/workflow.ts'],
      },
    ];
    mockLookupWorkItemSymbols.mockReturnValue(rawHints);
    mockSymbolHintsToKeyFiles.mockReturnValue([
      {
        path: 'slices/investigate/workflow.ts',
        reason: 'Symbol index: imports dispatchWave',
      },
    ]);

    const runtime: AgentRuntime = {
      run: vi.fn().mockResolvedValueOnce({
        output: makeImplementOutput({
          filesWritten: [
            {
              path: 'apps/server/src/domains/workflows/triage-batch.ts',
              reason: 'fix investigated surface',
            },
          ],
          testsWritten: [
            {
              path: 'apps/server/src/domains/workflows/triage-batch.test.ts',
              cases: 1,
            },
          ],
          testsRun: {
            command: 'pnpm test --reporter=json',
            paths: ['apps/server/src/domains/workflows/triage-batch.test.ts'],
          },
        }),
        decisionSummaries: [],
        events: [],
      } satisfies AgentResult),
    };

    const { runFixIssueWorkflow } = await import('./workflow.js');
    await runFixIssueWorkflow(item, source, 'proj', '/repo', {
      runtime,
      openPRImpl: vi.fn().mockResolvedValue({
        prNumber: 100,
        prUrl: 'https://github.com/owner/repo/pull/100',
        branch: 'factory/abc',
        base: 'main',
      }),
      adviseOnPlanImpl: vi.fn(),
      createWorktreeImpl: vi.fn().mockReturnValue('/work/wt'),
      cleanupWorktreeImpl: vi.fn(),
      resolveWorktreeHeadShaImpl: vi
        .fn()
        .mockReturnValue('abc1234567890abcdef1234567890abcdef1234'),
    });

    expect(mockLookupWorkItemSymbols).toHaveBeenCalledWith(
      'Fix dispatchWave',
      item.body,
      expect.objectContaining({ worktreePath: '/work/wt' }),
    );
    expect(mockSymbolHintsToKeyFiles).toHaveBeenCalledWith(
      rawHints,
      expect.objectContaining({
        existingPaths: [
          'apps/server/src/domains/workflows/triage-batch.ts',
          'core/agent-runtime/fallback.ts',
        ],
        maxFiles: 8,
      }),
    );

    const implementSpec = vi.mocked(runtime.run).mock.calls[0][0] as {
      context: Record<string, unknown> & {
        investigation?: { keyFiles?: Array<{ path: string; reason?: string }> };
      };
    };
    expect(implementSpec.context.investigation?.keyFiles?.map((file) => file.path)).toEqual([
      'apps/server/src/domains/workflows/triage-batch.ts',
      'core/agent-runtime/fallback.ts',
      'slices/investigate/workflow.ts',
    ]);
    expect(implementSpec.context.symbolIndexHints).toBeUndefined();
    expect(JSON.stringify(implementSpec.context)).not.toContain('"definedIn"');
    expect(JSON.stringify(implementSpec.context)).not.toContain('"callers"');
  });

  it('emits symbol-index.hints-used when implement tool calls touch curated symbol key files', async () => {
    const item = makeWorkItem({ priority: 'medium', type: 'bug', title: 'Fix dispatchWave' });
    const source = makeStateSource();
    vi.mocked(eventStore.replay).mockImplementation((filter = {}) => {
      if (filter.kind === 'agent.investigation-complete') return [makeInvestigationEvent(item)];
      if (filter.runId != null && filter.kind === 'agent.tool-call') {
        return [
          {
            id: 101,
            projectId: 'proj',
            workItemId: item.id,
            kind: 'agent.tool-call',
            payload: {
              tool_name: 'Read',
              tool_input: { file_path: '/work/wt/slices/investigate/workflow.ts' },
            },
            runId: String(filter.runId),
            createdAt: new Date().toISOString(),
          },
        ] as never;
      }
      return [];
    });
    mockLookupWorkItemSymbols.mockReturnValue([
      {
        name: 'dispatchWave',
        definedIn: 'core/agent-runtime/swarm.ts',
        line: 10,
        kind: 'function',
        callers: ['slices/investigate/workflow.ts'],
      },
    ]);
    mockSymbolHintsToKeyFiles.mockReturnValue([
      {
        path: 'slices/investigate/workflow.ts',
        reason: 'Symbol index: imports dispatchWave',
      },
    ]);

    const runtime: AgentRuntime = {
      run: vi.fn().mockResolvedValueOnce({
        output: makeImplementOutput({
          filesWritten: [
            {
              path: 'apps/server/src/domains/workflows/triage-batch.ts',
              reason: 'fix investigated surface',
            },
          ],
          testsWritten: [
            {
              path: 'apps/server/src/domains/workflows/triage-batch.test.ts',
              cases: 1,
            },
          ],
          testsRun: {
            command: 'pnpm test --reporter=json',
            paths: ['apps/server/src/domains/workflows/triage-batch.test.ts'],
          },
        }),
        decisionSummaries: [],
        events: [],
      } satisfies AgentResult),
    };

    const { runFixIssueWorkflow } = await import('./workflow.js');
    await runFixIssueWorkflow(item, source, 'proj', '/repo', {
      runtime,
      openPRImpl: vi.fn().mockResolvedValue({
        prNumber: 100,
        prUrl: 'https://github.com/owner/repo/pull/100',
        branch: 'factory/abc',
        base: 'main',
      }),
      adviseOnPlanImpl: vi.fn(),
      createWorktreeImpl: vi.fn().mockReturnValue('/work/wt'),
      cleanupWorktreeImpl: vi.fn(),
      resolveWorktreeHeadShaImpl: vi
        .fn()
        .mockReturnValue('abc1234567890abcdef1234567890abcdef1234'),
    });

    const hintsUsed = vi
      .mocked(eventStore.appendEvent)
      .mock.calls.find(([event]) => event.kind === 'symbol-index.hints-used');
    expect(hintsUsed?.[0].payload).toMatchObject({
      consumerSkill: 'implement',
      offeredHintCount: 1,
      usedHintCount: 1,
      usedHints: [
        { name: 'dispatchWave', path: 'slices/investigate/workflow.ts', source: 'key-file' },
      ],
    });
  });

  it('keeps wrong-surface guard anchored to investigation key files, not symbol key files', async () => {
    const item = makeWorkItem({ priority: 'medium', type: 'bug', title: 'Fix dispatchWave' });
    const source = makeStateSource();
    vi.mocked(eventStore.replay).mockReturnValue([makeInvestigationEvent(item)]);
    mockLookupWorkItemSymbols.mockReturnValue([
      {
        name: 'dispatchWave',
        definedIn: 'core/agent-runtime/swarm.ts',
        line: 10,
        kind: 'function',
        callers: ['slices/investigate/workflow.ts'],
      },
    ]);
    mockSymbolHintsToKeyFiles.mockReturnValue([
      {
        path: 'slices/investigate/workflow.ts',
        reason: 'Symbol index: imports dispatchWave',
      },
    ]);
    const openPRImpl = vi.fn();

    const runtime: AgentRuntime = {
      run: vi.fn().mockResolvedValueOnce({
        output: makeImplementOutput({
          filesWritten: [{ path: 'slices/investigate/workflow.ts', reason: 'symbol hint only' }],
          testsWritten: [{ path: 'slices/investigate/slice.test.ts', cases: 1 }],
          testsRun: {
            command: 'pnpm test --reporter=json',
            paths: ['slices/investigate/slice.test.ts'],
          },
        }),
        decisionSummaries: [],
        events: [],
      } satisfies AgentResult),
    };

    const { runFixIssueWorkflow } = await import('./workflow.js');
    await runFixIssueWorkflow(item, source, 'proj', '/repo', {
      runtime,
      openPRImpl,
      adviseOnPlanImpl: vi.fn(),
      createWorktreeImpl: vi.fn().mockReturnValue('/work/wt'),
      cleanupWorktreeImpl: vi.fn(),
      resolveWorktreeHeadShaImpl: vi
        .fn()
        .mockReturnValue('abc1234567890abcdef1234567890abcdef1234'),
    });

    expect(openPRImpl).not.toHaveBeenCalled();
    const guard = vi
      .mocked(eventStore.appendEvent)
      .mock.calls.find(([e]) => e.kind === 'agent.wrong-surface-guard');
    expect(guard?.[0].payload).toMatchObject({
      expectedKeyFiles: [
        'apps/server/src/domains/workflows/triage-batch.ts',
        'core/agent-runtime/fallback.ts',
      ],
    });
    expect((guard?.[0].payload as { expectedKeyFiles?: string[] }).expectedKeyFiles).not.toContain(
      'slices/investigate/workflow.ts',
    );
  });

  it('fires the frontend evidence gate after package-relative paths are normalized', async () => {
    const item = makeWorkItem({ priority: 'medium', type: 'bug' });
    const source = makeStateSource();
    const worktreePath = makeTempWorktree(['apps/web/src/components/chrome/slice.test.ts']);
    const openPRImpl = vi.fn();

    const runtime: AgentRuntime = {
      run: vi.fn().mockResolvedValueOnce({
        output: makeImplementOutput({
          filesWritten: [
            { path: 'src/components/chrome/slice.test.ts', reason: 'frontend regression test' },
          ],
          testsWritten: [{ path: 'src/components/chrome/slice.test.ts', cases: 1 }],
          testsRun: {
            command: 'pnpm test --reporter=json',
            paths: ['src/components/chrome/slice.test.ts'],
          },
          evidenceSpecPath: null,
        }),
        decisionSummaries: [],
        events: [],
      } satisfies AgentResult),
    };

    const { runFixIssueWorkflow } = await import('./workflow.js');
    await runFixIssueWorkflow(item, source, 'proj', '/repo', {
      runtime,
      openPRImpl,
      adviseOnPlanImpl: vi.fn(),
      createWorktreeImpl: vi.fn().mockReturnValue(worktreePath),
      cleanupWorktreeImpl: vi.fn(),
    });

    expect(openPRImpl).not.toHaveBeenCalled();
    const normalized = vi
      .mocked(eventStore.appendEvent)
      .mock.calls.find(([event]) => event.kind === 'agent.path-normalized');
    expect(normalized?.[0].payload).toMatchObject({ skill: 'implement' });
    const normalizedFields = (
      normalized?.[0].payload as { fields?: Array<Record<string, unknown>> }
    ).fields;
    expect(normalizedFields).toContainEqual({
      field: 'filesWritten[0].path',
      from: 'src/components/chrome/slice.test.ts',
      to: 'apps/web/src/components/chrome/slice.test.ts',
      source: 'package-root',
    });
    const failed = vi
      .mocked(eventStore.appendEvent)
      .mock.calls.find(([event]) => event.kind === 'agent.run-failed');
    expect((failed?.[0].payload as { error?: string }).error).toContain(
      'evidenceSpecPath is required when filesWritten includes apps/web/',
    );
  });

  it('passes the wrong-surface guard when normalized output matches an investigation key file', async () => {
    const item = makeWorkItem({ priority: 'medium', type: 'bug' });
    const source = makeStateSource();
    const worktreePath = makeTempWorktree([
      'apps/web/src/components/chrome/slice.test.ts',
      'apps/web/e2e/issue-42.spec.ts',
    ]);
    vi.mocked(eventStore.replay).mockReturnValue([
      makeInvestigationEvent(item, {
        keyFiles: [
          {
            path: 'apps/web/src/components/chrome/slice.test.ts',
            reason: 'frontend surface under investigation',
          },
        ],
      }),
    ]);
    const openPRImpl = vi.fn().mockResolvedValue({
      prNumber: 100,
      prUrl: 'https://github.com/owner/repo/pull/100',
      branch: 'factory/abc',
      base: 'main',
    });

    const runtime: AgentRuntime = {
      run: vi.fn().mockResolvedValueOnce({
        output: makeImplementOutput({
          filesWritten: [
            { path: 'src/components/chrome/slice.test.ts', reason: 'fix frontend surface' },
          ],
          testsWritten: [{ path: 'src/components/chrome/slice.test.ts', cases: 1 }],
          testsRun: {
            command: 'pnpm test --reporter=json',
            paths: ['src/components/chrome/slice.test.ts'],
          },
          evidenceSpecPath: 'apps/web/e2e/issue-42.spec.ts',
        }),
        decisionSummaries: [],
        events: [],
      } satisfies AgentResult),
    };

    const { runFixIssueWorkflow } = await import('./workflow.js');
    await runFixIssueWorkflow(item, source, 'proj', '/repo', {
      runtime,
      evidenceRuntime: {
        run: vi.fn().mockResolvedValue({
          output: {
            screenshots: [],
            gifPath: null,
            commentUrl: 'https://github.com/owner/repo/issues/42#issuecomment-1',
            commitSha: 'abc1234567890abcdef1234567890abcdef1234',
            decisionSummaries: [{ kind: 'GREEN', summary: 'Evidence captured' }],
          },
          decisionSummaries: [],
          events: [],
        } satisfies AgentResult),
      },
      openPRImpl,
      adviseOnPlanImpl: vi.fn(),
      createWorktreeImpl: vi.fn().mockReturnValue(worktreePath),
      cleanupWorktreeImpl: vi.fn(),
      resolveWorktreeHeadShaImpl: vi
        .fn()
        .mockReturnValue('abc1234567890abcdef1234567890abcdef1234'),
    });

    expect(openPRImpl).toHaveBeenCalled();
    const guard = vi
      .mocked(eventStore.appendEvent)
      .mock.calls.find(([event]) => event.kind === 'agent.wrong-surface-guard');
    expect(guard).toBeUndefined();
  });

  it('wrong-surface guard blocks PRs when implement output misses investigated files', async () => {
    const item = makeWorkItem({ priority: 'medium', type: 'bug' });
    const source = makeStateSource();
    vi.mocked(eventStore.replay).mockReturnValue([makeInvestigationEvent(item)]);
    const openPRImpl = vi.fn();

    const runtime: AgentRuntime = {
      run: vi.fn().mockResolvedValueOnce({
        output: makeImplementOutput({
          filesWritten: [
            { path: 'slices/parallel-implement/workflow.ts', reason: 'wrong surface' },
          ],
          testsWritten: [{ path: 'slices/parallel-implement/slice.test.ts', cases: 1 }],
          testsRun: {
            command: 'pnpm test --reporter=json',
            paths: ['slices/parallel-implement/slice.test.ts'],
          },
        }),
        decisionSummaries: [],
        events: [],
      } satisfies AgentResult),
    };

    const { runFixIssueWorkflow } = await import('./workflow.js');
    await runFixIssueWorkflow(item, source, 'proj', '/repo', {
      runtime,
      openPRImpl,
      adviseOnPlanImpl: vi.fn(),
      createWorktreeImpl: vi.fn().mockReturnValue('/work/wt'),
      cleanupWorktreeImpl: vi.fn(),
      resolveWorktreeHeadShaImpl: vi
        .fn()
        .mockReturnValue('abc1234567890abcdef1234567890abcdef1234'),
    });

    expect(openPRImpl).not.toHaveBeenCalled();
    const guard = vi
      .mocked(eventStore.appendEvent)
      .mock.calls.find(([e]) => e.kind === 'agent.wrong-surface-guard');
    expect(guard).toBeDefined();
    expect(guard?.[0].payload).toMatchObject({
      reason: 'implement-output-missed-investigation-surface',
      expectedKeyFiles: [
        'apps/server/src/domains/workflows/triage-batch.ts',
        'core/agent-runtime/fallback.ts',
      ],
      touchedPaths: [
        'slices/parallel-implement/workflow.ts',
        'slices/parallel-implement/slice.test.ts',
        'slices/parallel-implement/slice.test.ts',
      ],
    });
    expect(source.transitionState).toHaveBeenLastCalledWith(
      '42',
      'factory:in-progress',
      'factory:needs-human',
    );
  });

  it('records observed changed files and prefers them in the PR body', async () => {
    const item = makeWorkItem({ priority: 'medium' });
    const source = makeStateSource();
    const worktreePath = makeGitWorktree();

    const runtime: AgentRuntime = {
      run: vi.fn().mockImplementationOnce(async (spec) => {
        const wt = (spec.context as { worktreePath: string }).worktreePath;
        const observedPath = join(wt, 'core/observed.ts');
        mkdirSync(dirname(observedPath), { recursive: true });
        writeFileSync(observedPath, 'export const observed = true;\n');
        return {
          output: makeImplementOutput({
            filesWritten: [{ path: 'docs/model-only.md', reason: 'model declared this' }],
            testsWritten: [],
            testsRun: { command: 'pnpm test ', paths: [] },
          }),
          decisionSummaries: [],
          events: [],
        } satisfies AgentResult;
      }),
    };
    const openPRImpl = vi.fn().mockResolvedValue({
      prNumber: 100,
      prUrl: 'https://github.com/owner/repo/pull/100',
      branch: 'factory/abc',
      base: 'main',
    });

    const { runFixIssueWorkflow } = await import('./workflow.js');
    await runFixIssueWorkflow(item, source, 'proj', '/repo', {
      runtime,
      openPRImpl,
      adviseOnPlanImpl: vi.fn(),
      createWorktreeImpl: vi.fn().mockReturnValue(worktreePath),
      cleanupWorktreeImpl: vi.fn(),
      resolveWorktreeHeadShaImpl: vi
        .fn()
        .mockReturnValue('abc1234567890abcdef1234567890abcdef1234'),
    });

    const completeEvent = vi
      .mocked(eventStore.appendEvent)
      .mock.calls.find(([event]) => event.kind === 'agent.implement-complete');
    expect(completeEvent?.[0].payload).toMatchObject({
      observedChangedFiles: {
        count: 1,
        paths: ['core/observed.ts'],
      },
    });
    const prCall = vi.mocked(openPRImpl).mock.calls[0][0];
    expect(prCall.body).toContain('`core/observed.ts` — observed untracked change');
    expect(prCall.body).not.toContain('docs/model-only.md');
    const mismatchEvent = vi
      .mocked(eventStore.appendEvent)
      .mock.calls.find(([event]) => event.kind === 'agent.output-fact-mismatch');
    expect(mismatchEvent?.[0].payload).toMatchObject({
      skill: 'implement',
      observedChangedFiles: {
        count: 1,
        paths: ['core/observed.ts'],
      },
      observedWriteFiles: {
        count: 0,
        paths: [],
      },
      modelDeclaredFiles: {
        count: 1,
        paths: ['docs/model-only.md'],
      },
      mismatches: {
        observedNotDeclared: {
          count: 1,
          paths: ['core/observed.ts'],
        },
        declaredNotObserved: {
          count: 1,
          paths: ['docs/model-only.md'],
        },
      },
    });
  });

  it('records output fact mismatches from observed write tool audit paths', async () => {
    const item = makeWorkItem({ priority: 'medium' });
    const source = makeStateSource();
    const worktreePath = makeTempWorktree([]);
    vi.mocked(eventStore.replay).mockImplementation((filter = {}) => {
      if (filter.runId != null && filter.kind === 'agent.tool-call') {
        return [
          {
            id: 101,
            projectId: 'proj',
            workItemId: item.id,
            kind: 'agent.tool-call',
            payload: {
              tool_name: 'Write',
              canonical_path: { path: 'core/tool-observed.ts', root: 'worktree' },
            },
            runId: String(filter.runId),
            createdAt: new Date().toISOString(),
          },
        ] as never;
      }
      return [];
    });

    const runtime: AgentRuntime = {
      run: vi.fn().mockResolvedValueOnce({
        output: makeImplementOutput({
          filesWritten: [{ path: 'docs/model-only.md', reason: 'model declared this' }],
          testsWritten: [],
          testsRun: { command: 'pnpm test ', paths: [] },
        }),
        decisionSummaries: [],
        events: [],
      } satisfies AgentResult),
    };
    const openPRImpl = vi.fn().mockResolvedValue({
      prNumber: 100,
      prUrl: 'https://github.com/owner/repo/pull/100',
      branch: 'factory/abc',
      base: 'main',
    });

    const { runFixIssueWorkflow } = await import('./workflow.js');
    await runFixIssueWorkflow(item, source, 'proj', '/repo', {
      runtime,
      openPRImpl,
      adviseOnPlanImpl: vi.fn(),
      createWorktreeImpl: vi.fn().mockReturnValue(worktreePath),
      cleanupWorktreeImpl: vi.fn(),
      resolveWorktreeHeadShaImpl: vi
        .fn()
        .mockReturnValue('abc1234567890abcdef1234567890abcdef1234'),
    });

    expect(openPRImpl).toHaveBeenCalled();
    const mismatchEvent = vi
      .mocked(eventStore.appendEvent)
      .mock.calls.find(([event]) => event.kind === 'agent.output-fact-mismatch');
    expect(mismatchEvent?.[0].payload).toMatchObject({
      skill: 'implement',
      observedChangedFiles: {
        count: 0,
        paths: [],
      },
      observedWriteFiles: {
        count: 1,
        paths: ['core/tool-observed.ts'],
      },
      mismatches: {
        observedNotDeclared: {
          count: 1,
          paths: ['core/tool-observed.ts'],
        },
        declaredNotObserved: {
          count: 1,
          paths: ['docs/model-only.md'],
        },
      },
    });
  });

  it('wrong-surface guard can pass using observed git changes when model output omits the key file', async () => {
    const item = makeWorkItem({ priority: 'medium', type: 'bug' });
    const source = makeStateSource();
    const worktreePath = makeGitWorktree();
    vi.mocked(eventStore.replay).mockImplementation((filter = {}) => {
      if (filter.kind === 'agent.investigation-complete') {
        return [
          makeInvestigationEvent(item, {
            keyFiles: [{ path: 'core/observed.ts', reason: 'observed implementation surface' }],
          }),
        ];
      }
      return [];
    });

    const runtime: AgentRuntime = {
      run: vi.fn().mockImplementationOnce(async (spec) => {
        const wt = (spec.context as { worktreePath: string }).worktreePath;
        const observedPath = join(wt, 'core/observed.ts');
        mkdirSync(dirname(observedPath), { recursive: true });
        writeFileSync(observedPath, 'export const observed = true;\n');
        return {
          output: makeImplementOutput({
            filesWritten: [
              { path: 'slices/parallel-implement/workflow.ts', reason: 'stale model output' },
            ],
            testsWritten: [],
            testsRun: { command: 'pnpm test ', paths: [] },
          }),
          decisionSummaries: [],
          events: [],
        } satisfies AgentResult;
      }),
    };
    const openPRImpl = vi.fn().mockResolvedValue({
      prNumber: 100,
      prUrl: 'https://github.com/owner/repo/pull/100',
      branch: 'factory/abc',
      base: 'main',
    });

    const { runFixIssueWorkflow } = await import('./workflow.js');
    await runFixIssueWorkflow(item, source, 'proj', '/repo', {
      runtime,
      openPRImpl,
      adviseOnPlanImpl: vi.fn(),
      createWorktreeImpl: vi.fn().mockReturnValue(worktreePath),
      cleanupWorktreeImpl: vi.fn(),
      resolveWorktreeHeadShaImpl: vi
        .fn()
        .mockReturnValue('abc1234567890abcdef1234567890abcdef1234'),
    });

    expect(openPRImpl).toHaveBeenCalled();
    const guard = vi
      .mocked(eventStore.appendEvent)
      .mock.calls.find(([event]) => event.kind === 'agent.wrong-surface-guard');
    expect(guard).toBeUndefined();
  });

  it('wrong-surface guard records failed runs whose tool calls never touched investigation files', async () => {
    const item = makeWorkItem({ priority: 'medium', type: 'bug' });
    const source = makeStateSource();
    vi.mocked(eventStore.replay).mockImplementation((filter = {}) => {
      if (filter?.kind === 'agent.investigation-complete') return [makeInvestigationEvent(item)];
      if (filter?.runId != null) {
        return [
          {
            id: 101,
            projectId: 'proj',
            workItemId: item.id,
            kind: 'agent.tool-call',
            payload: {
              tool_name: 'Bash',
              tool_input: { command: "sed -n '1,220p' slices/parallel-implement/workflow.ts" },
            },
            createdAt: new Date().toISOString(),
            runId: filter.runId,
          },
        ] as never;
      }
      return [];
    });

    const runtime: AgentRuntime = {
      run: vi.fn().mockRejectedValueOnce(new Error('budget exceeded')),
    };

    const { runFixIssueWorkflow } = await import('./workflow.js');
    await runFixIssueWorkflow(item, source, 'proj', '/repo', {
      runtime,
      openPRImpl: vi.fn(),
      adviseOnPlanImpl: vi.fn(),
      createWorktreeImpl: vi.fn().mockReturnValue('/work/wt'),
      cleanupWorktreeImpl: vi.fn(),
      resolveWorktreeHeadShaImpl: vi
        .fn()
        .mockReturnValue('abc1234567890abcdef1234567890abcdef1234'),
    });

    const guard = vi
      .mocked(eventStore.appendEvent)
      .mock.calls.find(([e]) => e.kind === 'agent.wrong-surface-guard');
    expect(guard).toBeDefined();
    expect(guard?.[0].payload).toMatchObject({
      reason: 'tool-calls-missed-investigation-surface',
      expectedKeyFiles: [
        'apps/server/src/domains/workflows/triage-batch.ts',
        'core/agent-runtime/fallback.ts',
      ],
    });
  });

  it('priority:high — advisor proceed verdict short-circuits to PR (no re-spawn)', async () => {
    const item = makeWorkItem({ priority: 'high' });
    const source = makeStateSource();
    const runtime: AgentRuntime = {
      run: vi.fn().mockResolvedValueOnce({
        output: makeImplementOutput(),
        decisionSummaries: [],
        events: [],
      } satisfies AgentResult),
    };
    const openPRImpl = vi.fn().mockResolvedValue({
      prNumber: 1,
      prUrl: 'u',
      branch: 'b',
      base: 'main',
    });
    const adviseOnPlanImpl = vi.fn().mockResolvedValue({
      verdict: 'proceed',
      confidence: 'high',
      decisionSummaries: [{ kind: 'VERDICT', summary: 'sound' }],
    });

    const { runFixIssueWorkflow } = await import('./workflow.js');
    await runFixIssueWorkflow(item, source, 'proj', '/repo', {
      runtime,
      openPRImpl,
      adviseOnPlanImpl,
      createWorktreeImpl: vi.fn().mockReturnValue('/work/wt'),
      cleanupWorktreeImpl: vi.fn(),
      resolveWorktreeHeadShaImpl: vi
        .fn()
        .mockReturnValue('abc1234567890abcdef1234567890abcdef1234'),
    });

    expect(adviseOnPlanImpl).toHaveBeenCalledTimes(1);
    expect(runtime.run).toHaveBeenCalledTimes(1); // implement once; advisor proceed → no re-spawn
    expect(openPRImpl).toHaveBeenCalled();
    expect(mockAccumulatePersonaStats).toHaveBeenCalledWith({
      personaName: 'proj/developer/0',
      role: 'developer',
      outcome: 'success',
    });
  });

  it('priority:critical — advisor revise verdict re-spawns implement once with feedback', async () => {
    const item = makeWorkItem({ priority: 'critical' });
    const source = makeStateSource();
    const runMock = vi
      .fn()
      .mockResolvedValueOnce({
        output: makeImplementOutput({ plan: 'Original plan' }),
        decisionSummaries: [],
        events: [],
      } satisfies AgentResult)
      .mockResolvedValueOnce({
        output: makeImplementOutput({ plan: 'Revised plan' }),
        decisionSummaries: [],
        events: [],
      } satisfies AgentResult);
    const runtime: AgentRuntime = { run: runMock };
    const openPRImpl = vi.fn().mockResolvedValue({
      prNumber: 1,
      prUrl: 'u',
      branch: 'b',
      base: 'main',
    });
    const adviseOnPlanImpl = vi.fn().mockResolvedValue({
      verdict: 'revise',
      confidence: 'medium',
      feedback: 'use the existing helper at X',
      decisionSummaries: [{ kind: 'VERDICT', summary: 'duplicates X' }],
    });

    const { runFixIssueWorkflow } = await import('./workflow.js');
    await runFixIssueWorkflow(item, source, 'proj', '/repo', {
      runtime,
      openPRImpl,
      adviseOnPlanImpl,
      createWorktreeImpl: vi.fn().mockReturnValue('/work/wt'),
      cleanupWorktreeImpl: vi.fn(),
      resolveWorktreeHeadShaImpl: vi
        .fn()
        .mockReturnValue('abc1234567890abcdef1234567890abcdef1234'),
    });

    expect(runMock).toHaveBeenCalledTimes(2);
    const secondCall = runMock.mock.calls[1][0] as { context: Record<string, unknown> };
    expect(secondCall.context.advisorFeedback).toBe('use the existing helper at X');
    expect(secondCall.context.revisionPass).toBe(1);
    expect(openPRImpl).toHaveBeenCalled();
  });

  it('priority:high — advisor abort transitions to factory:needs-human and skips PR', async () => {
    const item = makeWorkItem({ priority: 'high' });
    const source = makeStateSource();
    const runtime: AgentRuntime = {
      run: vi.fn().mockResolvedValueOnce({
        output: makeImplementOutput(),
        decisionSummaries: [],
        events: [],
      } satisfies AgentResult),
    };
    const openPRImpl = vi.fn();
    const adviseOnPlanImpl = vi.fn().mockResolvedValue({
      verdict: 'abort',
      confidence: 'high',
      reason: 'plan modifies FACTORY_RULES.md (rule 12)',
      decisionSummaries: [{ kind: 'VERDICT', summary: 'governance violation' }],
    });

    const { runFixIssueWorkflow } = await import('./workflow.js');
    await runFixIssueWorkflow(item, source, 'proj', '/repo', {
      runtime,
      openPRImpl,
      adviseOnPlanImpl,
      createWorktreeImpl: vi.fn().mockReturnValue('/work/wt'),
      cleanupWorktreeImpl: vi.fn(),
      resolveWorktreeHeadShaImpl: vi
        .fn()
        .mockReturnValue('abc1234567890abcdef1234567890abcdef1234'),
    });

    expect(openPRImpl).not.toHaveBeenCalled();
    expect(source.comment).toHaveBeenCalledWith(
      '42',
      expect.stringContaining('plan modifies FACTORY_RULES.md'),
    );
    expect(source.transitionState).toHaveBeenLastCalledWith(
      '42',
      'factory:in-progress',
      'factory:needs-human',
    );
    expect(mockAccumulatePersonaStats).toHaveBeenCalledWith({
      personaName: 'proj/developer/0',
      role: 'developer',
      outcome: 'failure',
    });
  });

  it('on implement failure: emits agent.run-failed and transitions to needs-human', async () => {
    const item = makeWorkItem({ priority: 'medium' });
    const source = makeStateSource();
    const runtime: AgentRuntime = {
      run: vi.fn().mockRejectedValueOnce(new Error('implement crashed')),
    };
    const openPRImpl = vi.fn();
    const cleanupWorktreeImpl = vi.fn();
    const resolveWorktreeHeadShaImpl = vi
      .fn()
      .mockReturnValue('abc1234567890abcdef1234567890abcdef1234');

    const { runFixIssueWorkflow } = await import('./workflow.js');
    await runFixIssueWorkflow(item, source, 'proj', '/repo', {
      runtime,
      openPRImpl,
      adviseOnPlanImpl: vi.fn(),
      createWorktreeImpl: vi.fn().mockReturnValue('/work/wt'),
      cleanupWorktreeImpl,
      resolveWorktreeHeadShaImpl,
    });

    expect(openPRImpl).not.toHaveBeenCalled();
    const failed = vi
      .mocked(eventStore.appendEvent)
      .mock.calls.find(([e]) => e.kind === 'agent.run-failed');
    expect(failed).toBeDefined();
    expect(source.transitionState).toHaveBeenLastCalledWith(
      '42',
      'factory:in-progress',
      'factory:needs-human',
    );
    expect(cleanupWorktreeImpl).toHaveBeenCalled();
    expect(mockAccumulatePersonaStats).toHaveBeenCalledWith({
      personaName: 'proj/developer/0',
      role: 'developer',
      outcome: 'failure',
    });
  });

  it('emits one agent.decision-summary per implement summary + agent.implement-complete (#206 pattern)', async () => {
    const item = makeWorkItem({ priority: 'medium' });
    const source = makeStateSource();
    const out = makeImplementOutput({
      decisionSummaries: [
        { kind: 'PLAN', summary: 'a' },
        { kind: 'RED', summary: 'b' },
        { kind: 'GREEN', summary: 'c' },
      ],
    });
    const runtime: AgentRuntime = {
      run: vi.fn().mockResolvedValueOnce({
        output: out,
        decisionSummaries: [],
        events: [],
      } satisfies AgentResult),
    };
    const openPRImpl = vi.fn().mockResolvedValue({
      prNumber: 1,
      prUrl: 'u',
      branch: 'b',
      base: 'main',
    });

    const { runFixIssueWorkflow } = await import('./workflow.js');
    await runFixIssueWorkflow(item, source, 'proj', '/repo', {
      runtime,
      openPRImpl,
      adviseOnPlanImpl: vi.fn(),
      createWorktreeImpl: vi.fn().mockReturnValue('/work/wt'),
      cleanupWorktreeImpl: vi.fn(),
      resolveWorktreeHeadShaImpl: vi
        .fn()
        .mockReturnValue('abc1234567890abcdef1234567890abcdef1234'),
    });

    const decisionEvents = vi
      .mocked(eventStore.appendEvent)
      .mock.calls.filter(
        ([e]) =>
          e.kind === 'agent.decision-summary' &&
          (e.payload as { skill?: string }).skill === 'implement',
      );
    expect(decisionEvents).toHaveLength(3);

    const completeEvent = vi
      .mocked(eventStore.appendEvent)
      .mock.calls.find(([e]) => e.kind === 'agent.implement-complete');
    expect(completeEvent).toBeDefined();
    // #467 — testsRun is preserved verbatim on agent.implement-complete so
    // QA can pull it as devTestsRun when grading.
    expect((completeEvent?.[0].payload as { testsRun: unknown }).testsRun).toEqual({
      command: 'pnpm test ',
      paths: ['core/utils/strings.test.ts'],
    });
  });
});

describe('runFixIssueWorkflow — evidence-post branch coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetEventStoreMocks();
    mockAccumulatePersonaStats.mockClear();
    process.env.GITHUB_TOKEN = 'ghp_test';
  });

  afterEach(() => {
    process.env.GITHUB_TOKEN = undefined;
  });

  it('with evidenceSpecPath set: runs evidence-post skill and emits evidence.posted on success', async () => {
    const item = makeWorkItem({ priority: 'medium' });
    const source = makeStateSource();

    const evidenceOutput = {
      screenshots: [{ path: 'evidence/issue-42/step-1.png', caption: 'Initial state', step: 1 }],
      gifPath: null,
      commentUrl: 'https://github.com/owner/repo/issues/42#issuecomment-1',
      commitSha: 'abc1234567890abcdef',
      decisionSummaries: [{ kind: 'COMMIT', summary: 'Posted evidence comment' }],
    };

    const runtime: AgentRuntime = {
      run: vi
        .fn()
        .mockResolvedValueOnce({
          output: makeImplementOutput({ evidenceSpecPath: 'evidence/spec.json' }),
          decisionSummaries: [],
          events: [],
        } satisfies AgentResult)
        .mockResolvedValueOnce({
          output: evidenceOutput,
          decisionSummaries: [],
          events: [],
        } satisfies AgentResult),
    };

    const openPRImpl = vi.fn().mockResolvedValue({
      prNumber: 10,
      prUrl: 'https://github.com/owner/repo/pull/10',
      branch: 'factory/abc',
      base: 'main',
    });

    const { runFixIssueWorkflow } = await import('./workflow.js');
    await runFixIssueWorkflow(item, source, 'proj', '/repo', {
      runtime,
      openPRImpl,
      adviseOnPlanImpl: vi.fn(),
      createWorktreeImpl: vi.fn().mockReturnValue('/work/wt'),
      cleanupWorktreeImpl: vi.fn(),
      resolveWorktreeHeadShaImpl: vi
        .fn()
        .mockReturnValue('abc1234567890abcdef1234567890abcdef1234'),
    });

    // Two runtime.run calls: implement + evidence-post
    expect(vi.mocked(runtime.run)).toHaveBeenCalledTimes(2);

    const evidencePosted = vi
      .mocked(eventStore.appendEvent)
      .mock.calls.find(([e]) => e.kind === 'evidence.posted');
    expect(evidencePosted).toBeDefined();
  });

  it('passes worktreePath as workspaceDir on the evidence-post run spec (so git commands work)', async () => {
    const item = makeWorkItem({ priority: 'medium' });
    const source = makeStateSource();

    const evidenceOutput = {
      screenshots: [],
      gifPath: null,
      commentUrl: 'https://github.com/owner/repo/issues/42#issuecomment-2',
      commitSha: 'abc1234567890abcdef',
      decisionSummaries: [{ kind: 'COMMIT', summary: 'Posted evidence comment' }],
    };

    const runtime: AgentRuntime = {
      run: vi
        .fn()
        .mockResolvedValueOnce({
          output: makeImplementOutput({ evidenceSpecPath: 'evidence/spec.json' }),
          decisionSummaries: [],
          events: [],
        } satisfies AgentResult)
        .mockResolvedValueOnce({
          output: evidenceOutput,
          decisionSummaries: [],
          events: [],
        } satisfies AgentResult),
    };

    const openPRImpl = vi.fn().mockResolvedValue({
      prNumber: 10,
      prUrl: 'u',
      branch: 'b',
      base: 'main',
    });

    const { runFixIssueWorkflow } = await import('./workflow.js');
    await runFixIssueWorkflow(item, source, 'proj', '/repo', {
      runtime,
      openPRImpl,
      adviseOnPlanImpl: vi.fn(),
      createWorktreeImpl: vi.fn().mockReturnValue('/work/wt'),
      cleanupWorktreeImpl: vi.fn(),
      resolveWorktreeHeadShaImpl: vi
        .fn()
        .mockReturnValue('abc1234567890abcdef1234567890abcdef1234'),
    });

    const evidenceCall = vi.mocked(runtime.run).mock.calls[1][0] as unknown as {
      workspaceDir?: string;
    };
    expect(evidenceCall.workspaceDir).toBe('/work/wt');
  });

  it('looks up the BEFORE comment URL from agent.investigation-complete and passes into evidence-post context', async () => {
    const item = makeWorkItem({ priority: 'medium', type: 'bug' });
    const source = makeStateSource();

    const evidenceOutput = {
      screenshots: [],
      gifPath: null,
      commentUrl: 'https://github.com/owner/repo/issues/42#issuecomment-2',
      commitSha: 'abc1234567890abcdef',
      decisionSummaries: [{ kind: 'COMMIT', summary: 'Posted evidence comment' }],
    };

    const runtime: AgentRuntime = {
      run: vi
        .fn()
        .mockResolvedValueOnce({
          output: makeImplementOutput({ evidenceSpecPath: 'evidence/spec.json' }),
          decisionSummaries: [],
          events: [],
        } satisfies AgentResult)
        .mockResolvedValueOnce({
          output: evidenceOutput,
          decisionSummaries: [],
          events: [],
        } satisfies AgentResult),
    };

    const beforeUrl = 'https://github.com/owner/repo/issues/42#issuecomment-1';
    vi.mocked(eventStore.replay).mockReturnValue([
      {
        id: 1,
        projectId: 'proj',
        workItemId: item.id,
        kind: 'agent.investigation-complete',
        payload: { investigate: {}, playwrightRepro: { commentUrl: beforeUrl } },
        createdAt: new Date(),
        runId: 'r1',
      },
    ] as never);

    const openPRImpl = vi.fn().mockResolvedValue({
      prNumber: 10,
      prUrl: 'u',
      branch: 'b',
      base: 'main',
    });

    const { runFixIssueWorkflow } = await import('./workflow.js');
    await runFixIssueWorkflow(item, source, 'proj', '/repo', {
      runtime,
      openPRImpl,
      adviseOnPlanImpl: vi.fn(),
      createWorktreeImpl: vi.fn().mockReturnValue('/work/wt'),
      cleanupWorktreeImpl: vi.fn(),
      resolveWorktreeHeadShaImpl: vi
        .fn()
        .mockReturnValue('abc1234567890abcdef1234567890abcdef1234'),
    });

    const evidenceCall = vi.mocked(runtime.run).mock.calls[1][0] as unknown as {
      context: { workItem: { beforeCommentUrl?: string } };
      contextAllowlist: string[];
    };
    expect(evidenceCall.context.workItem.beforeCommentUrl).toBe(beforeUrl);
    expect(evidenceCall.contextAllowlist).toContain('workItem.beforeCommentUrl');
  });

  it('with evidenceSpecPath null: emits evidence.no-spec-declared and skips evidence-post run', async () => {
    const item = makeWorkItem({ priority: 'medium' });
    const source = makeStateSource();

    const runtime: AgentRuntime = {
      run: vi.fn().mockResolvedValueOnce({
        output: makeImplementOutput({ evidenceSpecPath: null }),
        decisionSummaries: [],
        events: [],
      } satisfies AgentResult),
    };

    const openPRImpl = vi.fn().mockResolvedValue({
      prNumber: 10,
      prUrl: 'https://github.com/owner/repo/pull/10',
      branch: 'factory/abc',
      base: 'main',
    });

    const { runFixIssueWorkflow } = await import('./workflow.js');
    await runFixIssueWorkflow(item, source, 'proj', '/repo', {
      runtime,
      openPRImpl,
      adviseOnPlanImpl: vi.fn(),
      createWorktreeImpl: vi.fn().mockReturnValue('/work/wt'),
      cleanupWorktreeImpl: vi.fn(),
      resolveWorktreeHeadShaImpl: vi
        .fn()
        .mockReturnValue('abc1234567890abcdef1234567890abcdef1234'),
    });

    // Only implement run — no evidence-post
    expect(vi.mocked(runtime.run)).toHaveBeenCalledTimes(1);

    const noSpec = vi
      .mocked(eventStore.appendEvent)
      .mock.calls.find(([e]) => e.kind === 'evidence.no-spec-declared');
    expect(noSpec).toBeDefined();
  });

  it('evidence-post runtime failure: emits evidence.post-failed and still transitions to needs-qa (best-effort)', async () => {
    const item = makeWorkItem({ priority: 'medium' });
    const source = makeStateSource();

    const runtime: AgentRuntime = {
      run: vi
        .fn()
        .mockResolvedValueOnce({
          output: makeImplementOutput({ evidenceSpecPath: 'evidence/spec.json' }),
          decisionSummaries: [],
          events: [],
        } satisfies AgentResult)
        .mockRejectedValueOnce(new Error('evidence-post timed out')),
    };

    const openPRImpl = vi.fn().mockResolvedValue({
      prNumber: 10,
      prUrl: 'https://github.com/owner/repo/pull/10',
      branch: 'factory/abc',
      base: 'main',
    });

    const { runFixIssueWorkflow } = await import('./workflow.js');
    await runFixIssueWorkflow(item, source, 'proj', '/repo', {
      runtime,
      openPRImpl,
      adviseOnPlanImpl: vi.fn(),
      createWorktreeImpl: vi.fn().mockReturnValue('/work/wt'),
      cleanupWorktreeImpl: vi.fn(),
      resolveWorktreeHeadShaImpl: vi
        .fn()
        .mockReturnValue('abc1234567890abcdef1234567890abcdef1234'),
    });

    // evidence-post failure is swallowed — workflow still completes
    const postFailed = vi
      .mocked(eventStore.appendEvent)
      .mock.calls.find(([e]) => e.kind === 'evidence.post-failed');
    expect(postFailed).toBeDefined();

    // Still transitions to needs-qa despite evidence-post failure
    expect(source.transitionState).toHaveBeenLastCalledWith(
      '42',
      'factory:in-progress',
      'factory:needs-qa',
    );
  });

  it('evidence-post invalid output: emits evidence.post-failed and still transitions to needs-qa', async () => {
    const item = makeWorkItem({ priority: 'medium' });
    const source = makeStateSource();

    const runtime: AgentRuntime = {
      run: vi
        .fn()
        .mockResolvedValueOnce({
          output: makeImplementOutput({ evidenceSpecPath: 'evidence/spec.json' }),
          decisionSummaries: [],
          events: [],
        } satisfies AgentResult)
        .mockResolvedValueOnce({
          // Bad output that will fail EvidencePostSchema
          output: { bad: 'data' },
          decisionSummaries: [],
          events: [],
        } satisfies AgentResult),
    };

    const openPRImpl = vi.fn().mockResolvedValue({
      prNumber: 10,
      prUrl: 'https://github.com/owner/repo/pull/10',
      branch: 'factory/abc',
      base: 'main',
    });

    const { runFixIssueWorkflow } = await import('./workflow.js');
    await runFixIssueWorkflow(item, source, 'proj', '/repo', {
      runtime,
      openPRImpl,
      adviseOnPlanImpl: vi.fn(),
      createWorktreeImpl: vi.fn().mockReturnValue('/work/wt'),
      cleanupWorktreeImpl: vi.fn(),
      resolveWorktreeHeadShaImpl: vi
        .fn()
        .mockReturnValue('abc1234567890abcdef1234567890abcdef1234'),
    });

    const postFailed = vi
      .mocked(eventStore.appendEvent)
      .mock.calls.find(([e]) => e.kind === 'evidence.post-failed');
    expect(postFailed).toBeDefined();

    expect(source.transitionState).toHaveBeenLastCalledWith(
      '42',
      'factory:in-progress',
      'factory:needs-qa',
    );
  });

  it('undefined GITHUB_TOKEN (removed from env): fails via ?? empty string fallback (line 322)', async () => {
    // Use Reflect.deleteProperty to truly remove the env key (not set to "undefined" string)
    const savedToken = process.env.GITHUB_TOKEN;
    Reflect.deleteProperty(process.env, 'GITHUB_TOKEN');
    const item = makeWorkItem({ priority: 'medium' });
    const source = makeStateSource();

    const runtime: AgentRuntime = {
      run: vi.fn().mockResolvedValueOnce({
        output: makeImplementOutput(),
        decisionSummaries: [],
        events: [],
      } satisfies AgentResult),
    };

    const openPRImpl = vi.fn();

    const { runFixIssueWorkflow } = await import('./workflow.js');
    try {
      await runFixIssueWorkflow(item, source, 'proj', '/repo', {
        runtime,
        openPRImpl,
        adviseOnPlanImpl: vi.fn(),
        createWorktreeImpl: vi.fn().mockReturnValue('/work/wt'),
        cleanupWorktreeImpl: vi.fn(),
        resolveWorktreeHeadShaImpl: vi
          .fn()
          .mockReturnValue('abc1234567890abcdef1234567890abcdef1234'),
      });
    } finally {
      if (savedToken !== undefined) process.env.GITHUB_TOKEN = savedToken;
    }

    // token = undefined ?? '' = '' → length === 0 → throws
    expect(openPRImpl).not.toHaveBeenCalled();
    expect(source.transitionState).toHaveBeenLastCalledWith(
      '42',
      'factory:in-progress',
      'factory:needs-human',
    );
  });

  it('missing GITHUB_TOKEN: fails and transitions to needs-human', async () => {
    process.env.GITHUB_TOKEN = '';
    const item = makeWorkItem({ priority: 'medium' });
    const source = makeStateSource();

    const runtime: AgentRuntime = {
      run: vi.fn().mockResolvedValueOnce({
        output: makeImplementOutput(),
        decisionSummaries: [],
        events: [],
      } satisfies AgentResult),
    };

    const openPRImpl = vi.fn();
    const cleanupWorktreeImpl = vi.fn();

    const { runFixIssueWorkflow } = await import('./workflow.js');
    await runFixIssueWorkflow(item, source, 'proj', '/repo', {
      runtime,
      openPRImpl,
      adviseOnPlanImpl: vi.fn(),
      createWorktreeImpl: vi.fn().mockReturnValue('/work/wt'),
      cleanupWorktreeImpl,
      resolveWorktreeHeadShaImpl: vi
        .fn()
        .mockReturnValue('abc1234567890abcdef1234567890abcdef1234'),
    });

    expect(openPRImpl).not.toHaveBeenCalled();
    expect(source.transitionState).toHaveBeenLastCalledWith(
      '42',
      'factory:in-progress',
      'factory:needs-human',
    );
    expect(cleanupWorktreeImpl).toHaveBeenCalled();
  });

  it('implement output validation failure: emits agent.run-failed and transitions to needs-human', async () => {
    const item = makeWorkItem({ priority: 'medium' });
    const source = makeStateSource();

    const runtime: AgentRuntime = {
      // Returns output that fails ImplementSchema validation
      run: vi.fn().mockResolvedValueOnce({
        output: { bad: 'data', missing: 'required fields' },
        decisionSummaries: [],
        events: [],
      } satisfies AgentResult),
    };

    const openPRImpl = vi.fn();

    const { runFixIssueWorkflow } = await import('./workflow.js');
    await runFixIssueWorkflow(item, source, 'proj', '/repo', {
      runtime,
      openPRImpl,
      adviseOnPlanImpl: vi.fn(),
      createWorktreeImpl: vi.fn().mockReturnValue('/work/wt'),
      cleanupWorktreeImpl: vi.fn(),
      resolveWorktreeHeadShaImpl: vi
        .fn()
        .mockReturnValue('abc1234567890abcdef1234567890abcdef1234'),
    });

    expect(openPRImpl).not.toHaveBeenCalled();
    const failed = vi
      .mocked(eventStore.appendEvent)
      .mock.calls.find(([e]) => e.kind === 'agent.run-failed');
    expect(failed).toBeDefined();
    expect(source.transitionState).toHaveBeenLastCalledWith(
      '42',
      'factory:in-progress',
      'factory:needs-human',
    );
  });

  it('PR body lists no files/tests when arrays are empty', async () => {
    const item = makeWorkItem({ priority: 'medium' });
    const source = makeStateSource();

    const runtime: AgentRuntime = {
      run: vi.fn().mockResolvedValueOnce({
        output: makeImplementOutput({ filesWritten: [], testsWritten: [] }),
        decisionSummaries: [],
        events: [],
      } satisfies AgentResult),
    };

    const openPRImpl = vi.fn().mockResolvedValue({
      prNumber: 1,
      prUrl: 'u',
      branch: 'b',
      base: 'main',
    });

    const { runFixIssueWorkflow } = await import('./workflow.js');
    await runFixIssueWorkflow(item, source, 'proj', '/repo', {
      runtime,
      openPRImpl,
      adviseOnPlanImpl: vi.fn(),
      createWorktreeImpl: vi.fn().mockReturnValue('/work/wt'),
      cleanupWorktreeImpl: vi.fn(),
      resolveWorktreeHeadShaImpl: vi
        .fn()
        .mockReturnValue('abc1234567890abcdef1234567890abcdef1234'),
    });

    const prCall = vi.mocked(openPRImpl).mock.calls[0][0];
    expect(prCall.body).toContain('_no files reported_');
    expect(prCall.body).toContain('_no tests reported_');
  });

  it('non-Error thrown (string): wraps as Error and transitions to needs-human', async () => {
    // Covers line 191: the `err instanceof Error ? err : new Error(String(err))` non-Error branch
    const item = makeWorkItem({ priority: 'medium' });
    const source = makeStateSource();

    const runtime: AgentRuntime = {
      // eslint-disable-next-line prefer-promise-reject-errors
      run: vi.fn().mockRejectedValueOnce('string error — not an Error object'),
    };

    const { runFixIssueWorkflow } = await import('./workflow.js');
    await runFixIssueWorkflow(item, source, 'proj', '/repo', {
      runtime,
      openPRImpl: vi.fn(),
      adviseOnPlanImpl: vi.fn(),
      createWorktreeImpl: vi.fn().mockReturnValue('/work/wt'),
      cleanupWorktreeImpl: vi.fn(),
      resolveWorktreeHeadShaImpl: vi
        .fn()
        .mockReturnValue('abc1234567890abcdef1234567890abcdef1234'),
    });

    // agent.run-failed should be emitted with string converted to Error message
    const failed = vi
      .mocked(eventStore.appendEvent)
      .mock.calls.find(([e]) => e.kind === 'agent.run-failed');
    expect(failed).toBeDefined();
    expect(source.transitionState).toHaveBeenLastCalledWith(
      '42',
      'factory:in-progress',
      'factory:needs-human',
    );
  });

  it('evidence-post: non-Error thrown wraps as Error (covers line 448)', async () => {
    // Covers line 448: `err instanceof Error ? err : new Error(String(err))` in runEvidencePost
    const item = makeWorkItem({ priority: 'medium' });
    const source = makeStateSource();

    const runtime: AgentRuntime = {
      run: vi
        .fn()
        .mockResolvedValueOnce({
          output: makeImplementOutput({ evidenceSpecPath: 'evidence/spec.json' }),
          decisionSummaries: [],
          events: [],
        } satisfies AgentResult)
        // evidence-post throws a non-Error (string)
        // eslint-disable-next-line prefer-promise-reject-errors
        .mockRejectedValueOnce('network timeout string'),
    };

    const openPRImpl = vi.fn().mockResolvedValue({
      prNumber: 10,
      prUrl: 'https://github.com/owner/repo/pull/10',
      branch: 'factory/abc',
      base: 'main',
    });

    const { runFixIssueWorkflow } = await import('./workflow.js');
    await runFixIssueWorkflow(item, source, 'proj', '/repo', {
      runtime,
      openPRImpl,
      adviseOnPlanImpl: vi.fn(),
      createWorktreeImpl: vi.fn().mockReturnValue('/work/wt'),
      cleanupWorktreeImpl: vi.fn(),
      resolveWorktreeHeadShaImpl: vi
        .fn()
        .mockReturnValue('abc1234567890abcdef1234567890abcdef1234'),
    });

    const postFailed = vi
      .mocked(eventStore.appendEvent)
      .mock.calls.find(([e]) => e.kind === 'evidence.post-failed');
    expect(postFailed).toBeDefined();
  });
});

describe('resolveWorktreeHeadSha (M7.bug fix — #233 SHA pinning)', () => {
  it('returns the real HEAD SHA from a git repo', async () => {
    const { execFileSync } = await import('node:child_process');
    const { mkdtempSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');

    const dir = mkdtempSync(join(tmpdir(), 'wt-sha-'));
    try {
      // Run all git commands in this throwaway fixture repo with global +
      // system config disabled so the host's commit-signing setup doesn't
      // bleed in. Signing is off; user identity is set per-call via
      // -c flags.
      const isolatedEnv = {
        ...process.env,
        GIT_CONFIG_GLOBAL: '/dev/null',
        GIT_CONFIG_SYSTEM: '/dev/null',
      };
      execFileSync('git', ['init', '-q'], { cwd: dir, env: isolatedEnv });
      execFileSync(
        'git',
        [
          '-c',
          'commit.gpgsign=false',
          '-c',
          'user.email=test@example.com',
          '-c',
          'user.name=Test',
          'commit',
          '--allow-empty',
          '-m',
          'seed',
        ],
        { cwd: dir, env: isolatedEnv },
      );

      const { resolveWorktreeHeadSha } = await import('./workflow.js');
      const sha = resolveWorktreeHeadSha(dir);

      expect(sha).toMatch(/^[0-9a-f]{40}$/);
      // Must satisfy EvidencePostSchema's >= 7 char constraint (#233 contract).
      expect(sha.length).toBeGreaterThanOrEqual(7);
      expect(sha).not.toBe('HEAD');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('falls back to "HEAD" when the path is not a git repo (loud failure path)', async () => {
    const { mkdtempSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const dir = mkdtempSync(join(tmpdir(), 'wt-sha-bad-'));
    try {
      const { resolveWorktreeHeadSha } = await import('./workflow.js');
      const sha = resolveWorktreeHeadSha(dir);
      // Fallback is intentionally invalid — fails EvidencePostSchema.prHeadSha
      // (>= 7 chars) so runEvidencePost surfaces the failure as
      // evidence.post-failed instead of silently posting a broken URL.
      expect(sha).toBe('HEAD');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
