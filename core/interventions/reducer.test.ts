import { describe, expect, it } from 'vitest';
import {
  abort,
  decide,
  markApplying,
  open,
  propose,
  recordApplicationResult,
  reopen,
  resolve,
  verify,
} from './reducer.js';
import { listInterventionEvents } from './repository.js';

function openFixture(suffix: string) {
  const result = open({
    projectId: 'proj',
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

describe('intervention reducer', () => {
  it('opens once per active root-cause signature and audits dedupe', () => {
    const first = openFixture('dedupe');
    const second = open({
      projectId: first.projectId,
      workItemId: first.workItemId,
      interventionType: 'needs_human',
      title: 'Needs human',
      reason: 'Repeated event',
      rootCauseSignature: first.rootCauseSignature,
      actor: 'test',
    });

    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.intervention.id).toBe(first.id);
    expect(listInterventionEvents(first.id).map((event) => event.eventType)).toEqual([
      'open',
      'dedupe',
    ]);
  });

  it('enforces CAS on double decide', () => {
    const intervention = openFixture('cas');
    const proposed = propose({
      id: intervention.id,
      expectedVersion: intervention.version,
      options: [
        {
          actionType: 'no_action',
          label: 'Leave open',
          description: 'Wait for more evidence',
          payload: { reason: 'insufficient evidence' },
          risk: 'low',
        },
      ],
    });
    expect(proposed.ok).toBe(true);
    if (!proposed.ok) return;

    const first = decide({
      id: intervention.id,
      expectedVersion: proposed.intervention.version,
      actionType: 'no_action',
      actionPayload: { reason: 'insufficient evidence' },
      decidedBy: 'operator',
    });
    const second = decide({
      id: intervention.id,
      expectedVersion: proposed.intervention.version,
      actionType: 'no_action',
      actionPayload: { reason: 'stale click' },
      decidedBy: 'operator',
    });

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.status).toBe(409);
  });

  it('records apply, verify, resolve, and reopen history', () => {
    const intervention = openFixture('lifecycle');
    const decided = decide({
      id: intervention.id,
      expectedVersion: intervention.version,
      actionType: 'no_action',
      actionPayload: { reason: 'manual test' },
      decidedBy: 'operator',
    });
    expect(decided.ok).toBe(true);
    if (!decided.ok) return;
    const applying = markApplying({
      id: intervention.id,
      expectedVersion: decided.intervention.version,
      leaseOwner: 'worker',
      leaseExpiresAt: new Date(Date.now() + 1000).toISOString(),
    });
    expect(applying.ok).toBe(true);
    if (!applying.ok) return;
    const applied = recordApplicationResult({
      id: intervention.id,
      expectedVersion: applying.intervention.version,
      ok: true,
      result: { ok: true },
    });
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    const verified = verify({
      id: intervention.id,
      expectedVersion: applied.intervention.version,
      verification: { ok: true },
    });
    expect(verified.ok).toBe(true);
    if (!verified.ok) return;
    const resolved = resolve({
      id: intervention.id,
      expectedVersion: verified.intervention.version,
      reason: 'done',
    });
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    const reopened = reopen({
      id: intervention.id,
      expectedVersion: resolved.intervention.version,
      reason: 'same blockage recurred',
    });
    expect(reopened.ok).toBe(true);
    if (!reopened.ok) return;
    expect(reopened.intervention.status).toBe('OPEN');
    expect(listInterventionEvents(intervention.id).map((event) => event.eventType)).toEqual([
      'open',
      'decide',
      'markApplying',
      'recordApplicationResult',
      'verify',
      'resolve',
      'reopen',
    ]);
  });

  it('rejects illegal status transitions', () => {
    const intervention = openFixture('illegal');
    const applying = markApplying({
      id: intervention.id,
      expectedVersion: intervention.version,
      leaseOwner: 'worker',
      leaseExpiresAt: new Date(Date.now() + 1000).toISOString(),
    });
    expect(applying.ok).toBe(false);
    if (!applying.ok) expect(applying.error).toContain('illegal intervention transition');
  });

  it('aborts active interventions', () => {
    const intervention = openFixture('abort');
    const aborted = abort({
      id: intervention.id,
      expectedVersion: intervention.version,
      reason: 'operator cancelled',
      actor: 'operator',
    });
    expect(aborted.ok).toBe(true);
    if (!aborted.ok) return;
    expect(aborted.intervention.status).toBe('ABORTED');
  });
});
