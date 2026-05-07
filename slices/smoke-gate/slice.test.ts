import { beforeEach, describe, expect, it, vi } from 'vitest';

// ─── module mocks ────────────────────────────────────────────────────────────

const mockAppendEvent = vi.fn();
vi.mock('@goose-hub/core/event-stream/store.js', () => ({
  eventStore: { appendEvent: (...args: unknown[]) => mockAppendEvent(...args) },
}));

const mockExecSync = vi.fn();
vi.mock('node:child_process', () => ({ execSync: (...args: unknown[]) => mockExecSync(...args) }));

// Fluent drizzle mock that supports: select().from().limit().all()
const { mockDb } = vi.hoisted(() => {
  const FLUENT = ['select', 'from', 'where', 'limit'] as const;
  const m: Record<string, unknown> = {};
  for (const method of FLUENT) {
    m[method] = vi.fn().mockReturnValue(m);
  }
  m.all = vi.fn().mockReturnValue([{ n: 1 }]);
  m.run = vi.fn().mockReturnValue(undefined);
  return { mockDb: m as Record<string, ReturnType<typeof vi.fn>> };
});

vi.mock('@goose-hub/core/db/db.js', () => ({ db: mockDb }));
vi.mock('@goose-hub/core/db/schema.js', () => ({
  events: { id: 'id', projectId: 'project_id', kind: 'kind', payload: 'payload', createdAt: 'created_at' },
}));

// ─── helpers ─────────────────────────────────────────────────────────────────

import type { ProjectConfig } from '@goose-hub/core/types.js';

function makeConfig(overrides: Partial<{ slug: string; budgets: Partial<ProjectConfig['budgets']> }> = {}): ProjectConfig {
  return {
    id: 'test-project',
    slug: overrides.slug ?? 'test-slug',
    name: 'Test',
    source: { kind: 'github', repo: 'owner/repo', stateMachine: 'labels' },
    targetRepo: { cloneUrl: '', defaultBranch: 'main', localPath: '' },
    stack: {
      runtime: 'node',
      packageManager: 'pnpm',
      buildCommand: '',
      testCommand: '',
      lintCommand: '',
      typecheckCommand: '',
      e2eCommand: '',
      detectedAt: '',
    },
    mode: 'supervised',
    storage: { kind: 'local', path: '' },
    repos: [],
    agentConfig: {
      runtime: 'claude-cli',
      rolesModels: {} as ProjectConfig['agentConfig']['rolesModels'],
      fallbackPolicy: {} as ProjectConfig['agentConfig']['fallbackPolicy'],
      toolAllowlists: {} as ProjectConfig['agentConfig']['toolAllowlists'],
      advisorMode: {
        enabled: false,
        triggerOn: { priorities: [] },
        maxAdvisorBudgetUsd: 0,
        disableInAutonomous: true,
      },
      retrospectivePolicy: { defaultTier: 'light', deepTriggers: [] },
      coachPolicy: { enabled: false, consistencyThreshold: 0, minLifecycles: 0 },
    },
    budgets: {
      dailyTokens: 1_000_000,
      maxParallelAgents: 1,
      maxRetries: 2,
      maxIssuesPerDayFromNonOwners: 3,
      maxBashSeconds: 60,
      perWorkflowMaxUsd: 10,
      perAgentMaxUsd: 5,
      perAdvisorMaxUsd: 1,
      ...overrides.budgets,
    },
    governance: { immutablePaths: [] },
    isolation: { mode: 'native' },
    archiveAfterDays: 7,
    visibility: 'always_visible',
    colorStripe: '#000',
  } as ProjectConfig;
}

function resetMocks(): void {
  vi.clearAllMocks();
  mockExecSync.mockReturnValue(Buffer.from('ok'));
  for (const method of ['select', 'from', 'where', 'limit']) {
    mockDb[method] = vi.fn().mockReturnValue(mockDb);
  }
  mockDb.all = vi.fn().mockReturnValue([{ n: 1 }]);
  mockDb.run = vi.fn();
}

import { clearSmokeCache, runSmoke } from '@goose-hub/core/orchestrator/smoke.js';

describe('runSmoke', () => {
  beforeEach(() => {
    resetMocks();
    process.env.ANTHROPIC_API_KEY = 'test-key';
  });

  it('returns ok when all checks pass', async () => {
    clearSmokeCache('test-slug');
    const result = await runSmoke(makeConfig());
    expect(result.ok).toBe(true);
    expect(result.failedCheck).toBeUndefined();
  });

  it('emits workflow.smoke-failed when gh auth fails', async () => {
    clearSmokeCache('test-slug');
    mockExecSync.mockImplementationOnce(() => {
      throw Object.assign(new Error('auth failed'), { stderr: Buffer.from('not logged in') });
    });
    const result = await runSmoke(makeConfig());
    expect(result.ok).toBe(false);
    expect(result.failedCheck).toBe('gh-auth');
    expect(mockAppendEvent).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'workflow.smoke-failed' }),
    );
  });

  it('emits workflow.smoke-failed when git fsck fails', async () => {
    clearSmokeCache('test-slug');
    mockExecSync
      .mockReturnValueOnce(Buffer.from('ok')) // gh auth status
      .mockImplementationOnce(() => {
        throw Object.assign(new Error('fsck error'), { stderr: Buffer.from('broken objects') });
      });
    const result = await runSmoke(makeConfig());
    expect(result.ok).toBe(false);
    expect(result.failedCheck).toBe('git-fsck');
    expect(mockAppendEvent).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'workflow.smoke-failed' }),
    );
  });

  it('emits workflow.smoke-failed when claude binary missing', async () => {
    clearSmokeCache('test-slug');
    mockExecSync
      .mockReturnValueOnce(Buffer.from('ok')) // gh auth
      .mockReturnValueOnce(Buffer.from('ok')) // git fsck
      .mockImplementationOnce(() => {
        throw Object.assign(new Error('not found'), { stderr: Buffer.from('command not found') });
      });
    const result = await runSmoke(makeConfig());
    expect(result.ok).toBe(false);
    expect(result.failedCheck).toBe('claude-version');
  });

  it('emits workflow.smoke-failed when ANTHROPIC_API_KEY is empty', async () => {
    clearSmokeCache('test-slug');
    // Use empty string — process.env values are always strings; empty string is falsy
    process.env.ANTHROPIC_API_KEY = '';
    const result = await runSmoke(makeConfig());
    expect(result.ok).toBe(false);
    expect(result.failedCheck).toBe('api-key');
    expect(mockAppendEvent).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'workflow.smoke-failed' }),
    );
  });

  it('emits workflow.smoke-failed when budget floor not met', async () => {
    clearSmokeCache('budget-low');
    const result = await runSmoke(makeConfig({ slug: 'budget-low', budgets: { perWorkflowMaxUsd: 0.1 } }));
    expect(result.ok).toBe(false);
    expect(result.failedCheck).toBe('budget-floor');
  });

  it('caches result for 60s and does not re-run checks', async () => {
    clearSmokeCache('cached-slug');
    const config = makeConfig({ slug: 'cached-slug' });
    const r1 = await runSmoke(config);
    const r2 = await runSmoke(config);
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    // execSync should only have been called for the first run (3 shell checks)
    expect(mockExecSync).toHaveBeenCalledTimes(3);
  });
});
