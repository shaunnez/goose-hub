import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  approveIssue: vi.fn(),
  bustCache: vi.fn(),
  dispatchResolveConflict: vi.fn(),
  dispatchResumeIssue: vi.fn(),
  emitStateTransitionEvent: vi.fn(),
  getSourceForSlug: vi.fn(),
  rejectIssue: vi.fn(),
}));

vi.mock('@goose-hub/core/event-stream/state-transition.js', () => ({
  emitStateTransitionEvent: mocks.emitStateTransitionEvent,
}));

vi.mock('#shared/cache.js', () => ({
  bustCache: mocks.bustCache,
  CACHE_KEY: { issues: (slug: string) => `issues:${slug}` },
}));

vi.mock('#shared/dispatch.js', () => ({
  dispatchResolveConflict: mocks.dispatchResolveConflict,
  dispatchResumeIssue: mocks.dispatchResumeIssue,
}));

vi.mock('#shared/source.js', () => ({
  getSourceForSlug: mocks.getSourceForSlug,
}));

vi.mock('../issues/service.js', () => ({
  approveIssue: mocks.approveIssue,
  rejectIssue: mocks.rejectIssue,
}));

import { createServerInterventionApplierDeps } from './applier-worker.js';

const source = {
  getItem: vi.fn(),
  transitionState: vi.fn(),
};

describe('server intervention applier deps', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    source.getItem.mockResolvedValue({ state: 'factory:needs-human' });
    source.transitionState.mockResolvedValue(undefined);
    mocks.getSourceForSlug.mockResolvedValue(source);
    mocks.approveIssue.mockResolvedValue({ ok: true, data: { ok: true, sha: 'abc', prNumber: 1 } });
    mocks.rejectIssue.mockResolvedValue({ ok: true, data: { ok: true } });
    mocks.dispatchResumeIssue.mockResolvedValue(undefined);
    mocks.dispatchResolveConflict.mockResolvedValue(undefined);
  });

  it('applies manual transitions through the source and emits intervention metadata', async () => {
    const deps = createServerInterventionApplierDeps();

    await deps.transitionState({
      projectId: 'proj',
      workItemId: 'github:owner/repo#42',
      from: 'factory:needs-human',
      to: 'factory:triaging',
      interventionId: 'i1',
      correlationId: 'c1',
      reason: 'retry triage',
    });

    expect(source.transitionState).toHaveBeenCalledWith(
      'github:owner/repo#42',
      'factory:needs-human',
      'factory:triaging',
      'retry triage',
    );
    expect(mocks.emitStateTransitionEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: 'proj',
        workItemId: 'github:owner/repo#42',
        from: 'factory:needs-human',
        to: 'factory:triaging',
        extraPayload: {
          interventionId: 'i1',
          causedByInterventionId: 'i1',
          correlationId: 'c1',
        },
      }),
    );
  });

  it('rejects manual transitions when the source state changed before apply', async () => {
    const deps = createServerInterventionApplierDeps();
    source.getItem.mockResolvedValueOnce({ state: 'factory:in-progress' });

    await expect(
      deps.transitionState({
        projectId: 'proj',
        workItemId: 'github:owner/repo#42',
        from: 'factory:needs-human',
        to: 'factory:triaging',
        interventionId: 'i1',
        correlationId: 'c1',
      }),
    ).rejects.toThrow('state changed before apply');

    expect(source.transitionState).not.toHaveBeenCalled();
    expect(mocks.emitStateTransitionEvent).not.toHaveBeenCalled();
  });

  it('passes intervention identity into gate appliers and resume dispatch', async () => {
    const deps = createServerInterventionApplierDeps();

    await deps.approveGate?.({
      projectId: 'proj',
      workItemId: 'github:owner/repo#42',
      interventionId: 'i1',
      correlationId: 'c1',
    });
    await deps.rejectGate?.({
      projectId: 'proj',
      workItemId: 'github:owner/repo#42',
      reason: 'needs changes',
      interventionId: 'i2',
      correlationId: 'c2',
    });
    await deps.resumeWorkflow?.({
      projectId: 'proj',
      workItemId: 'github:owner/repo#42',
      interventionId: 'i3',
      correlationId: 'c3',
    });

    expect(mocks.approveIssue).toHaveBeenCalledWith('proj', '42', {
      intervention: { id: 'i1', correlationId: 'c1' },
    });
    expect(mocks.rejectIssue).toHaveBeenCalledWith('proj', '42', 'needs changes', {
      intervention: { id: 'i2', correlationId: 'c2' },
    });
    expect(mocks.dispatchResumeIssue).toHaveBeenCalledWith('proj', 42, {
      intervention: { id: 'i3', correlationId: 'c3' },
    });
  });
});
