import type { AgentResult, AgentRuntime } from '@goose-hub/core/agent-runtime/interface.js';
import type { StateSource, WorkItem } from '@goose-hub/core/state-source/interface.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@goose-hub/core/event-stream/store.js', () => ({
  eventStore: { appendEvent: vi.fn().mockReturnValue({ id: 1 }) },
}));
vi.mock('@goose-hub/core/agent-runtime/select-persona.js', () => ({
  selectPersona: vi.fn().mockReturnValue('proj/developer/0'),
}));
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return { ...actual, readFileSync: vi.fn().mockReturnValue('# mock skill prompt') };
});

import { eventStore } from '@goose-hub/core/event-stream/store.js';

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
    prUrl: 'https://github.com/owner/repo/issues/42',
    evidenceSpecPath: null as string | null,
    confidence: 'high' as const,
    decisionSummaries: [
      { step: 'plan', summary: 'Add helper at core/utils/strings.ts' },
      { step: 'green', summary: 'All 3 tests pass' },
    ],
    ...overrides,
  };
}

describe('runFixIssueWorkflow (#183)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

    const { runFixIssueWorkflow } = await import('./workflow.js');
    await runFixIssueWorkflow(item, source, 'proj', '/repo', {
      runtime,
      openPRImpl,
      adviseOnPlanImpl,
      createWorktreeImpl,
      cleanupWorktreeImpl,
    });

    expect(createWorktreeImpl).toHaveBeenCalledWith('/repo', expect.any(String));
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
    expect(cleanupWorktreeImpl).toHaveBeenCalled();
    // pr.opened event recorded
    const opened = vi
      .mocked(eventStore.appendEvent)
      .mock.calls.find(([e]) => e.kind === 'pr.opened');
    expect(opened).toBeDefined();
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
      decisionSummaries: [{ step: 'review', summary: 'sound' }],
    });

    const { runFixIssueWorkflow } = await import('./workflow.js');
    await runFixIssueWorkflow(item, source, 'proj', '/repo', {
      runtime,
      openPRImpl,
      adviseOnPlanImpl,
      createWorktreeImpl: vi.fn().mockReturnValue('/work/wt'),
      cleanupWorktreeImpl: vi.fn(),
    });

    expect(adviseOnPlanImpl).toHaveBeenCalledTimes(1);
    expect(runtime.run).toHaveBeenCalledTimes(1); // implement once; advisor proceed → no re-spawn
    expect(openPRImpl).toHaveBeenCalled();
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
      decisionSummaries: [{ step: 'review', summary: 'duplicates X' }],
    });

    const { runFixIssueWorkflow } = await import('./workflow.js');
    await runFixIssueWorkflow(item, source, 'proj', '/repo', {
      runtime,
      openPRImpl,
      adviseOnPlanImpl,
      createWorktreeImpl: vi.fn().mockReturnValue('/work/wt'),
      cleanupWorktreeImpl: vi.fn(),
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
      decisionSummaries: [{ step: 'review', summary: 'governance violation' }],
    });

    const { runFixIssueWorkflow } = await import('./workflow.js');
    await runFixIssueWorkflow(item, source, 'proj', '/repo', {
      runtime,
      openPRImpl,
      adviseOnPlanImpl,
      createWorktreeImpl: vi.fn().mockReturnValue('/work/wt'),
      cleanupWorktreeImpl: vi.fn(),
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
  });

  it('on implement failure: emits agent.run-failed and transitions to needs-human', async () => {
    const item = makeWorkItem({ priority: 'medium' });
    const source = makeStateSource();
    const runtime: AgentRuntime = {
      run: vi.fn().mockRejectedValueOnce(new Error('implement crashed')),
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
  });

  it('emits one agent.decision-summary per implement summary + agent.implement-complete (#206 pattern)', async () => {
    const item = makeWorkItem({ priority: 'medium' });
    const source = makeStateSource();
    const out = makeImplementOutput({
      decisionSummaries: [
        { step: 'plan', summary: 'a' },
        { step: 'red', summary: 'b' },
        { step: 'green', summary: 'c' },
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
