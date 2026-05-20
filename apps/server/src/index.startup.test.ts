import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  appFetch: vi.fn(),
  closeOrphanedRuns: vi.fn(),
  dispatchTriageBatch: vi.fn(),
  loadProjects: vi.fn(),
  loggerError: vi.fn(),
  loggerInfo: vi.fn(),
  replayEvents: vi.fn(),
  recoverStaleApplying: vi.fn(),
  recoverStaleProposalLeases: vi.fn(),
  runTriageBatch: vi.fn(),
  serve: vi.fn(),
  startServerInterventionApplierWorker: vi.fn(),
  startInterventionProposerWorker: vi.fn(),
  startNightlyAuditScheduler: vi.fn(),
  startPerProjectScheduler: vi.fn(),
  subscribeEvents: vi.fn(),
}));

vi.mock('@goose-hub/core/audit/nightly-scheduler.js', () => ({
  startNightlyAuditScheduler: mocks.startNightlyAuditScheduler,
}));

vi.mock('@goose-hub/core/event-stream/store.js', () => ({
  eventStore: {
    closeOrphanedRuns: mocks.closeOrphanedRuns,
    replay: mocks.replayEvents,
    subscribe: mocks.subscribeEvents,
  },
}));

vi.mock('@goose-hub/core/logger.js', () => ({
  logger: {
    error: mocks.loggerError,
    info: mocks.loggerInfo,
  },
}));

vi.mock('@goose-hub/core/interventions/reducer.js', () => ({
  recoverStaleApplying: mocks.recoverStaleApplying,
  recoverStaleProposalLeases: mocks.recoverStaleProposalLeases,
}));

vi.mock('@goose-hub/core/interventions/proposer.js', () => ({
  startInterventionProposerWorker: mocks.startInterventionProposerWorker,
}));

vi.mock('./domains/interventions/applier-worker.js', () => ({
  startServerInterventionApplierWorker: mocks.startServerInterventionApplierWorker,
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

function unsetEnv(name: string): void {
  Reflect.deleteProperty(process.env, name);
}

describe('server startup', () => {
  const originalVitest = process.env.VITEST;
  const originalSecret = process.env.GITHUB_WEBHOOK_SECRET;
  const originalPort = process.env.PORT;

  beforeEach(() => {
    vi.resetModules();
    vi.resetAllMocks();
    unsetEnv('VITEST');
    process.env.GITHUB_WEBHOOK_SECRET = 'test-secret';
    unsetEnv('PORT');
    mocks.closeOrphanedRuns.mockReturnValue(0);
    mocks.dispatchTriageBatch.mockResolvedValue(undefined);
    mocks.loadProjects.mockResolvedValue([{ slug: 'goose-hub-self' }]);
    mocks.replayEvents.mockReturnValue([]);
    mocks.recoverStaleApplying.mockReturnValue([]);
    mocks.recoverStaleProposalLeases.mockReturnValue([]);
    mocks.subscribeEvents.mockReturnValue(() => undefined);
  });

  afterEach(() => {
    if (originalVitest == null) {
      unsetEnv('VITEST');
    } else {
      process.env.VITEST = originalVitest;
    }

    if (originalSecret == null) {
      unsetEnv('GITHUB_WEBHOOK_SECRET');
    } else {
      process.env.GITHUB_WEBHOOK_SECRET = originalSecret;
    }

    if (originalPort == null) {
      unsetEnv('PORT');
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

  it('recovers stale intervention leases and starts intervention workers', async () => {
    mocks.recoverStaleProposalLeases.mockReturnValue([{ id: 'proposal-lease' }]);
    mocks.recoverStaleApplying.mockReturnValue([{ id: 'apply-lease' }]);

    await import('./index.js');

    expect(mocks.recoverStaleProposalLeases).toHaveBeenCalledTimes(1);
    expect(mocks.recoverStaleApplying).toHaveBeenCalledTimes(1);
    expect(mocks.startInterventionProposerWorker).toHaveBeenCalledTimes(1);
    expect(mocks.startServerInterventionApplierWorker).toHaveBeenCalledTimes(1);
    expect(mocks.loggerInfo).toHaveBeenCalledWith('startup: recovered stale intervention leases', {
      proposer: 1,
      apply: 1,
    });
  });
});
