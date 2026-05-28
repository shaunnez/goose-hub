// core/audit/slice.test.ts
// Lightweight slice contract: nightly scheduler arms one timer per project
// and the scheduler honours the test-injected `runAudit` seam without
// touching the filesystem when the project's `localPath` is missing.

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockExistsSync = vi.fn();

vi.mock('node:fs', async (importOriginal) => {
  const actual = (await importOriginal()) as object;
  return { ...actual, existsSync: (...args: unknown[]) => mockExistsSync(...args) };
});
vi.mock('node:os', async (importOriginal) => {
  const actual = (await importOriginal()) as object;
  return { ...actual, homedir: () => '/mock-home' };
});

const { startNightlyAuditScheduler } = await import('./nightly-scheduler.js');

function projectStub(slug: string, localPath: string): import('../types.js').ProjectConfig {
  return {
    id: slug,
    name: slug,
    slug,
    source: { kind: 'github', repo: 'x/y', stateMachine: 'labels' },
    targetRepo: { cloneUrl: 'git@github.com:x/y.git', defaultBranch: 'main', localPath },
    stack: {
      runtime: 'node',
      packageManager: 'pnpm',
      testCommand: 'pnpm test',
      detectedAt: '2026-05-11T00:00:00Z',
    },
    mode: 'supervised',
    storage: { kind: 'local', path: '/tmp/x' },
    repos: ['x/y'],
    agentConfig: {
      runtime: 'auto',
      rolesModels: {},
      fallbackPolicy: {},
      advisorMode: {
        enabled: false,
        triggerOn: { priorities: [] },
        maxAdvisorBudgetUsd: 0,
        disableInAutonomous: true,
      },
      retrospectivePolicy: { defaultTier: 'light', deepTriggers: [] },
    },
    budgets: {
      dailyTokens: 0,
      maxParallelAgents: 1,
      maxRetries: 0,
      perBashCommandMaxSeconds: 60,
      perWorkflowMaxUsd: 1,
      perAgentMaxUsd: 1,
      perAdvisorMaxUsd: 0,
    },
    governance: { immutablePaths: [] },
    isolation: { mode: 'native' },
    archiveAfterDays: 7,
    visibility: 'always_visible',
    colorStripe: '#ffffff',
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
});

describe('startNightlyAuditScheduler', () => {
  it('fires audit per project once the first-delay elapses', async () => {
    mockExistsSync.mockReturnValue(true);
    const runAudit = vi.fn().mockResolvedValue({
      ok: true,
      auditScore: 80,
      pipelineRunId: 'p',
      autonomyGateFired: false,
      output: {} as never,
      improvementCandidates: [],
    });
    const projects = [projectStub('a', '/tmp/a'), projectStub('b', '/tmp/b')];

    const scheduler = startNightlyAuditScheduler(projects, {
      firstDelayMs: 100,
      intervalMs: 1_000,
      runAudit: runAudit as unknown as typeof import('./run-audit.js').runCodeQualityAudit,
    });

    expect(runAudit).not.toHaveBeenCalled();
    // Per-project jitter spreads timers up to firstDelayMs; advance well
    // past the longest staggered fire so both projects have run.
    await vi.advanceTimersByTimeAsync(250);
    expect(runAudit).toHaveBeenCalledTimes(2);
    expect(
      runAudit.mock.calls.every(([arg]) => (arg as { trigger: string }).trigger === 'nightly'),
    ).toBe(true);

    scheduler.stop();
  });

  it('staggers per-project fires within firstDelayMs ceiling', async () => {
    mockExistsSync.mockReturnValue(true);
    const fireTimes: number[] = [];
    const runAudit = vi.fn().mockImplementation(() => {
      fireTimes.push(Date.now());
      return Promise.resolve({
        ok: true,
        auditScore: 80,
        pipelineRunId: 'p',
        autonomyGateFired: false,
        output: {} as never,
        improvementCandidates: [],
      });
    });
    const projects = [
      projectStub('a', '/tmp/a'),
      projectStub('b', '/tmp/b'),
      projectStub('c', '/tmp/c'),
      projectStub('d', '/tmp/d'),
    ];
    const start = Date.now();
    const scheduler = startNightlyAuditScheduler(projects, {
      firstDelayMs: 200,
      intervalMs: 1_000,
      runAudit: runAudit as unknown as typeof import('./run-audit.js').runCodeQualityAudit,
    });

    await vi.advanceTimersByTimeAsync(450);
    expect(runAudit).toHaveBeenCalledTimes(4);
    // First fire must respect the base delay; subsequent fires must be
    // strictly later than the prior one (deterministic stagger).
    expect(fireTimes[0] - start).toBeGreaterThanOrEqual(200);
    for (let i = 1; i < fireTimes.length; i++) {
      expect(fireTimes[i]).toBeGreaterThanOrEqual(fireTimes[i - 1]);
    }
    scheduler.stop();
  });

  it('skips when project.targetRepo.localPath does not exist', async () => {
    mockExistsSync.mockReturnValue(false);
    const runAudit = vi.fn();
    const scheduler = startNightlyAuditScheduler([projectStub('a', '/missing')], {
      firstDelayMs: 0,
      runAudit: runAudit as unknown as typeof import('./run-audit.js').runCodeQualityAudit,
    });

    await vi.advanceTimersByTimeAsync(10);
    expect(runAudit).not.toHaveBeenCalled();
    scheduler.stop();
  });

  it('resolves ~ in localPath against homedir', async () => {
    mockExistsSync.mockReturnValue(true);
    const runAudit = vi.fn().mockResolvedValue({
      ok: true,
      auditScore: 80,
      pipelineRunId: 'p',
      autonomyGateFired: false,
      output: {} as never,
      improvementCandidates: [],
    });
    const scheduler = startNightlyAuditScheduler([projectStub('a', '~/code/repo')], {
      firstDelayMs: 0,
      runAudit: runAudit as unknown as typeof import('./run-audit.js').runCodeQualityAudit,
    });

    await vi.advanceTimersByTimeAsync(10);
    expect(runAudit).toHaveBeenCalledOnce();
    expect((runAudit.mock.calls[0][0] as { worktreePath: string }).worktreePath).toBe(
      '/mock-home/code/repo',
    );
    scheduler.stop();
  });
});
