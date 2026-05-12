import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  appFetch: vi.fn(),
  closeOrphanedRuns: vi.fn(),
  dispatchTriageBatch: vi.fn(),
  loadProjects: vi.fn(),
  loggerError: vi.fn(),
  loggerInfo: vi.fn(),
  runTriageBatch: vi.fn(),
  serve: vi.fn(),
  startNightlyAuditScheduler: vi.fn(),
  startPerProjectScheduler: vi.fn(),
}));

vi.mock('@goose-hub/core/audit/nightly-scheduler.js', () => ({
  startNightlyAuditScheduler: mocks.startNightlyAuditScheduler,
}));

vi.mock('@goose-hub/core/event-stream/store.js', () => ({
  eventStore: {
    closeOrphanedRuns: mocks.closeOrphanedRuns,
  },
}));

vi.mock('@goose-hub/core/logger.js', () => ({
  logger: {
    error: mocks.loggerError,
    info: mocks.loggerInfo,
  },
}));

vi.mock('@goose-hub/core/projects/loader.js', () => ({
  loadProjects: mocks.loadProjects,
}));

vi.mock('@goose-hub/core/projects/scheduler.js', () => ({
  startPerProjectScheduler: mocks.startPerProjectScheduler,
}));

vi.mock('@hono/node-server', () => ({
  serve: mocks.serve,
}));

vi.mock('./domains/workflows/triage-batch.js', () => ({
  runTriageBatch: mocks.runTriageBatch,
}));

vi.mock('./server.js', () => ({
  app: { fetch: mocks.appFetch },
}));

vi.mock('#shared/dispatch.js', () => ({
  dispatchTriageBatch: mocks.dispatchTriageBatch,
}));

describe('server startup', () => {
  const originalVitest = process.env.VITEST;
  const originalSecret = process.env.GITHUB_WEBHOOK_SECRET;
  const originalPort = process.env.PORT;

  beforeEach(() => {
    vi.resetModules();
    vi.resetAllMocks();
    process.env.VITEST = undefined;
    process.env.GITHUB_WEBHOOK_SECRET = 'test-secret';
    process.env.PORT = undefined;
    mocks.closeOrphanedRuns.mockReturnValue(0);
    mocks.dispatchTriageBatch.mockResolvedValue(undefined);
    mocks.loadProjects.mockResolvedValue([{ slug: 'goose-hub-self' }]);
  });

  afterEach(() => {
    if (originalVitest == null) {
      process.env.VITEST = undefined;
    } else {
      process.env.VITEST = originalVitest;
    }

    if (originalSecret == null) {
      process.env.GITHUB_WEBHOOK_SECRET = undefined;
    } else {
      process.env.GITHUB_WEBHOOK_SECRET = originalSecret;
    }

    if (originalPort == null) {
      process.env.PORT = undefined;
    } else {
      process.env.PORT = originalPort;
    }
  });

  it('routes scheduler ticks through dispatchTriageBatch so triage runs are coalesced', async () => {
    await import('./index.js');

    await vi.waitFor(() => {
      expect(mocks.startPerProjectScheduler).toHaveBeenCalledTimes(1);
    });

    const [, tickFn] = mocks.startPerProjectScheduler.mock.calls[0] as [
      Array<{ slug: string }>,
      (slug: string) => Promise<void>,
    ];

    await tickFn('goose-hub-self');

    expect(mocks.dispatchTriageBatch).toHaveBeenCalledWith('goose-hub-self');
    expect(mocks.runTriageBatch).not.toHaveBeenCalled();
  });
});
