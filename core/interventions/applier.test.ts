import { describe, expect, it, vi } from 'vitest';
import type { InterventionApplierDeps } from './applier.js';
import { applyDecidedIntervention, runInterventionApplierWorkerOnce } from './applier.js';
import { decide, markApplying, open, recoverStaleApplying } from './reducer.js';
import { getIntervention, listInterventionEvents } from './repository.js';

function openFixture(suffix: string) {
  const result = open({
    projectId: `proj-${suffix}`,
    workItemId: `github:owner/repo#${suffix}`,
    interventionType: 'needs_human',
    title: 'Needs human',
    reason: 'Workflow asked for help',
    rootCauseSignature: `needs-human|${suffix}`,
    actor: 'test',
  });
  if (!result.ok) throw new Error(result.error);
  return result.intervention;
}

function decideNoAction(suffix: string) {
  const intervention = openFixture(suffix);
  const result = decide({
    id: intervention.id,
    expectedVersion: intervention.version,
    actionType: 'no_action',
    actionPayload: { reason: 'operator chose no action' },
    decidedBy: 'operator',
  });
  if (!result.ok) throw new Error(result.error);
  return result.intervention;
}

describe('intervention applier worker', () => {
  it('applies decided rows once and resolves them', async () => {
    const intervention = decideNoAction('applier-success');
    const deps: InterventionApplierDeps = {
      transitionState: vi.fn(),
    };

    const result = await runInterventionApplierWorkerOnce({
      projectId: intervention.projectId,
      deps,
      leaseOwner: 'test-applier',
    });

    expect(result).toEqual({ processed: 1, applied: 1, failed: 0, skipped: 0 });
    const current = getIntervention(intervention.id);
    expect(current?.status).toBe('RESOLVED');
    expect(listInterventionEvents(intervention.id).map((event) => event.eventType)).toEqual([
      'open',
      'decide',
      'markApplying',
      'recordApplicationResult',
      'verify',
      'resolve',
    ]);

    const second = await runInterventionApplierWorkerOnce({
      projectId: intervention.projectId,
      deps,
      leaseOwner: 'test-applier',
    });
    expect(second).toEqual({ processed: 0, applied: 0, failed: 0, skipped: 0 });
  });

  it('records failed applies as FAILED', async () => {
    const openIntervention = openFixture('applier-failure');
    const decided = decide({
      id: openIntervention.id,
      expectedVersion: openIntervention.version,
      actionType: 'manual_transition',
      actionPayload: {
        from: 'factory:needs-human',
        to: 'factory:triaging',
      },
      decidedBy: 'operator',
    });
    expect(decided.ok).toBe(true);
    if (!decided.ok) return;
    const deps: InterventionApplierDeps = {
      transitionState: vi.fn().mockRejectedValue(new Error('source rejected transition')),
    };

    const result = await runInterventionApplierWorkerOnce({
      projectId: decided.intervention.projectId,
      deps,
      leaseOwner: 'test-applier',
    });

    expect(result).toEqual({ processed: 1, applied: 0, failed: 1, skipped: 0 });
    const current = getIntervention(decided.intervention.id);
    expect(current?.status).toBe('FAILED');
    expect(current?.applicationResult).toEqual({
      ok: false,
      result: { error: 'source rejected transition' },
    });
  });

  it('validates decided payload again before execution', async () => {
    const intervention = decideNoAction('applier-revalidates');
    const deps: InterventionApplierDeps = {
      transitionState: vi.fn(),
    };

    const result = await applyDecidedIntervention({
      intervention: {
        ...intervention,
        decidedActionType: 'manual_transition',
        decidedActionPayload: {
          from: 'factory:needs-human',
          to: 'factory:done',
        },
      },
      deps,
      leaseOwner: 'test-applier',
    });

    expect(result).toEqual({
      ok: false,
      error: 'illegal transition factory:needs-human -> factory:done',
    });
    expect(deps.transitionState).not.toHaveBeenCalled();
    expect(getIntervention(intervention.id)?.status).toBe('DECIDED');
  });

  it('recovers stale APPLYING leases back to DECIDED for retry', () => {
    const intervention = decideNoAction('stale-applying');
    const applying = markApplying({
      id: intervention.id,
      expectedVersion: intervention.version,
      leaseOwner: 'old-worker',
      leaseExpiresAt: '2026-01-01T00:00:00Z',
    });
    expect(applying.ok).toBe(true);

    const recovered = recoverStaleApplying({
      now: new Date('2026-01-01T00:01:00Z'),
      actor: 'recovery',
    });

    expect(recovered.map((item) => item.id)).toContain(intervention.id);
    const current = getIntervention(intervention.id);
    expect(current?.status).toBe('DECIDED');
    expect(current?.leaseOwner).toBeNull();
    expect(current?.leaseExpiresAt).toBeNull();
    expect(listInterventionEvents(intervention.id).map((event) => event.eventType)).toEqual([
      'open',
      'decide',
      'markApplying',
      'applyLeaseRecovered',
    ]);
  });
});
